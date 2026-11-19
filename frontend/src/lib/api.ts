import type { Vec3 } from "./geometry";
import type {
  ApiInfo,
  AuthUser,
  BackendVoxel,
  CreatedLink,
  InviteCheck,
  InviteInfo,
  JobListItem,
  JobStatus,
  MeResponse,
  Role,
  SampleCase,
  Summary,
  TeamMember,
  Volume,
  VolumeHeader,
} from "./types";
import { makeVolume } from "./volumes";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/**
 * Sent with every request that changes something. The server refuses such
 * requests without it, so another website cannot make a signed-in browser
 * act on this one (a cross-site page cannot add custom headers).
 */
const CLIENT_HEADER = { "X-Glioma-Client": "web" } as const;

/** Fired when the server says the session is gone, so the app can show the sign-in page. */
export const SIGNED_OUT_EVENT = "glioma:signed-out";

function noticeStatus(status: number) {
  if (status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) return body.detail.map((d: { msg?: string }) => d.msg).join("; ");
  } catch {
    /* not JSON */
  }
  return `Request failed (${response.status})`;
}

export async function getJsonPublic<T>(path: string): Promise<T> {
  return getJson<T>(path);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(BASE + path, { credentials: "same-origin" });
  if (!response.ok) {
    noticeStatus(response.status);
    throw new ApiError(await detailOf(response), response.status);
  }
  return (await response.json()) as T;
}

/** A request that changes state: JSON in, JSON (or nothing) out. */
async function send<T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await fetch(BASE + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? CLIENT_HEADER : { ...CLIENT_HEADER, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (path !== "/api/auth/login") noticeStatus(response.status);
    throw new ApiError(await detailOf(response), response.status);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const getInfo = () => getJson<ApiInfo>("/api/info");
export const getJob = (id: string) => getJson<JobStatus>(`/api/jobs/${id}`);
export const getSummary = (id: string) => getJson<Summary>(`/api/jobs/${id}/summary`);
export const meshUrl = (id: string, name: string) => `${BASE}/api/jobs/${id}/meshes/${name}.glb`;
export const downloadUrl = (id: string) => `${BASE}/api/jobs/${id}/download/segmentation.nii.gz`;
export const bundleUrl = (id: string) => `${BASE}/api/jobs/${id}/download/results.zip`;
export const previewUrl = (id: string) => `${BASE}/api/jobs/${id}/download/preview.png`;
export const listSamples = () => getJson<SampleCase[]>("/api/samples");

/** Open a curated sample: returns its (possibly already finished) job. */
export const openSample = (id: string) => send<{ job_id: string; status: string }>("POST", `/api/samples/${encodeURIComponent(id)}/open`);

export async function deleteJob(id: string): Promise<void> {
  try {
    await send<void>("DELETE", `/api/jobs/${id}`);
  } catch (reason) {
    if (!(reason instanceof ApiError && reason.status === 404)) throw reason;
  }
}

/** The signed-in account's own results, newest first. */
export const listMyJobs = () => getJson<JobListItem[]>("/api/jobs");

/* ---------------------------------------------------------------- accounts */

export const getMe = () => getJson<MeResponse>("/api/auth/me");
export const signIn = (username: string, password: string) => send<{ user: AuthUser }>("POST", "/api/auth/login", { username, password });
export const signOut = () => send<void>("POST", "/api/auth/logout");
export const checkInvite = (token: string) => send<InviteCheck>("POST", "/api/auth/invite", { token });
export const redeemInvite = (body: { token: string; username?: string; display_name?: string; password: string }) =>
  send<{ user: AuthUser }>("POST", "/api/auth/signup", body);
export const changePassword = (current_password: string, new_password: string) =>
  send<{ user: AuthUser }>("POST", "/api/auth/password", { current_password, new_password });
export const updateProfile = (display_name: string) => send<{ user: AuthUser }>("PATCH", "/api/auth/profile", { display_name });

export const listTeam = () => getJson<TeamMember[]>("/api/admin/users");
export const updateMember = (id: string, patch: { role?: Role; disabled?: boolean }) => send<AuthUser>("PATCH", `/api/admin/users/${id}`, patch);
export const removeMember = (id: string) => send<void>("DELETE", `/api/admin/users/${id}`);
export const makeResetLink = (id: string) => send<CreatedLink>("POST", `/api/admin/users/${id}/reset-link`);
export const listInvites = () => getJson<InviteInfo[]>("/api/admin/invites");
export const makeInvite = (role: Role, note: string, hours: number) => send<CreatedLink>("POST", "/api/admin/invites", { role, note, hours });
export const revokeInvite = (id: string) => send<void>("DELETE", `/api/admin/invites/${id}`);

export async function getVolume(id: string, name: string): Promise<Volume> {
  const header = await getJson<VolumeHeader>(`/api/jobs/${id}/volumes/${name}/header`);
  // The body is gzip-encoded on the wire; the browser decodes it transparently.
  const response = await fetch(`${BASE}/api/jobs/${id}/volumes/${name}`, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(await detailOf(response), response.status);
  return makeVolume(header, await response.arrayBuffer());
}

export function getVoxel(id: string, world: Vec3, signal?: AbortSignal): Promise<BackendVoxel> {
  const query = `x=${world[0]}&y=${world[1]}&z=${world[2]}`;
  return fetch(`${BASE}/api/jobs/${id}/voxel?${query}`, { signal, credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) throw new ApiError(await detailOf(response), response.status);
    return (await response.json()) as BackendVoxel;
  });
}

/** Demo mode: start a job on the server's built-in synthetic case. */
export const createSampleJob = () => send<{ job_id: string }>("POST", "/api/demo/sample");

export interface UploadFiles {
  t1: File;
  t1c: File;
  t2: File;
  flair: File;
  segmentation?: File | null;
}

/**
 * Gzip an uncompressed .nii in the browser before upload. Four raw MRI volumes
 * are ~140 MB; compressed they are 3–4× smaller, which keeps uploads fast and
 * under the ~100 MB request limit of tunnels such as Cloudflare's.
 */
export async function gzipIfUncompressed(file: File): Promise<File> {
  if (!/\.nii$/i.test(file.name) || typeof CompressionStream === "undefined") return file;
  const compressed = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return new File([compressed], `${file.name}.gz`, { type: "application/gzip" });
}

/** POST /api/jobs with upload progress (fetch cannot report it, XHR can). */
export async function createJob(
  files: UploadFiles,
  alreadyPreprocessed: boolean,
  onProgress: (fraction: number) => void,
): Promise<{ job_id: string }> {
  const [t1, t1c, t2, flair, segmentation] = await Promise.all(
    [files.t1, files.t1c, files.t2, files.flair, files.segmentation ?? null].map((file) => (file ? gzipIfUncompressed(file) : null)),
  );
  return sendJob({ t1: t1!, t1c: t1c!, t2: t2!, flair: flair!, segmentation }, alreadyPreprocessed, onProgress);
}

function sendJob(
  files: UploadFiles,
  alreadyPreprocessed: boolean,
  onProgress: (fraction: number) => void,
): Promise<{ job_id: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("t1", files.t1);
    form.append("t1c", files.t1c);
    form.append("t2", files.t2);
    form.append("flair", files.flair);
    if (files.segmentation) form.append("segmentation", files.segmentation);
    form.append("already_preprocessed", String(alreadyPreprocessed));

    const request = new XMLHttpRequest();
    request.open("POST", `${BASE}/api/jobs`);
    request.withCredentials = true;
    request.setRequestHeader("X-Glioma-Client", CLIENT_HEADER["X-Glioma-Client"]);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onerror = () => reject(new ApiError("Could not reach the server.", 0));
    request.onload = () => {
      let body: { job_id?: string; detail?: unknown } = {};
      try {
        body = JSON.parse(request.responseText);
      } catch {
        /* not JSON */
      }
      if (request.status >= 200 && request.status < 300 && body.job_id) {
        resolve({ job_id: body.job_id });
      } else {
        noticeStatus(request.status);
        const detail =
          typeof body.detail === "string"
            ? body.detail
            : request.status === 413
              ? "The files are larger than the server accepts."
              : `Upload failed (${request.status})`;
        reject(new ApiError(detail, request.status));
      }
    };
    request.send(form);
  });
}

export const register = (username: string, password: string, display_name = "") => send<{ user: AuthUser }>("POST", "/api/auth/register", { username, password, display_name });

export interface ComparisonStatus {
  status: "registering" | "done" | "error";
  message?: string;
  note?: string;
  coverage_fraction?: number;
  meshes?: Summary["meshes"];
  change_meshes?: Summary["meshes"];
  change_ml?: Record<string, number>;
}
export const startComparison = (a: string, b: string) => send<ComparisonStatus>("POST", `/api/comparisons/${a}/${b}?same_patient=true`);
export const getComparison = (a: string, b: string) => getJson<ComparisonStatus>(`/api/comparisons/${a}/${b}`);
export async function getComparisonVolume(a: string, b: string, name: string): Promise<Volume> {
  const path = `${BASE}/api/comparisons/${a}/${b}/volumes/${name}`;
  const header = await getJson<VolumeHeader>(`/api/comparisons/${a}/${b}/volumes/${name}/header`);
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(await detailOf(response), response.status);
  return makeVolume(header, await response.arrayBuffer());
}

export const comparisonMeshUrl = (a: string, b: string, name: string) => `${BASE}/api/comparisons/${a}/${b}/meshes/${name}.glb`;

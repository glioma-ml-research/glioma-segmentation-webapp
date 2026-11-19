import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../lib/auth";
import { lastJob } from "../lib/server";
import type { ApiInfo } from "../lib/types";
import { BrandMark, IconArrowUpRight, IconClose, IconMenu } from "./Icons";

export const REPO = "https://github.com/glioma-ml-research/mu-glioma-segmentation-benchmark";
export const DATASET = "https://doi.org/10.7937/7K9K-3C83";
export const TEAM = ["Atilla Mustafa", "Elkhan Aghakishiyev", "Jamila Jabrayilli"];

export function ModeStatus({ info }: { info: ApiInfo | null }) {
  if (!info) return null;
  if (info.mode === "demo") return <span className="status demo" title={info.message}>Demo mode</span>;
  if (info.mode === "model_error") return <span className="status error" title={info.message}>Model error</span>;
  return (
    <span className="status ok" title={info.message}>
      Model ready · {info.model?.device?.toUpperCase() ?? ""}
    </span>
  );
}

export function SiteNav({ info }: { info: ApiInfo | null }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const recent = lastJob();
  const { user, signOut } = useAuth();

  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  const links = (
    <>
      <Link className="nav-link" to="/#samples">
        Samples
      </Link>
      <Link className="nav-link" to="/#accuracy">
        Accuracy
      </Link>
      <NavLink className="nav-link" to="/about">
        Model card
      </NavLink>
      {user && <NavLink className="nav-link" to="/results">My results</NavLink>}
      {user && <NavLink className="nav-link" to="/account">Account</NavLink>}
      {user?.role === "admin" && <NavLink className="nav-link" to="/team">Team</NavLink>}
      {user ? <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out</button> : <Link className="nav-link" to="/signin">Sign in</Link>}
      {recent && (
        <NavLink className="nav-link" to={`/viewer/${recent}`}>
          Last result
        </NavLink>
      )}
    </>
  );

  return (
    <>
      <header className="nav">
        <Link className="brand" to="/">
          <BrandMark />
          <span className="brand-name">Postoperative glioma segmentation</span>
        </Link>
        <nav className="nav-links" aria-label="Main">
          {links}
        </nav>
        <div className="nav-right">
          <ModeStatus info={info} />
          <Link className="btn btn-primary btn-sm nav-cta" to="/new">
            Upload scans
          </Link>
          <button className="btn btn-ghost btn-icon nav-menu-btn" aria-expanded={open} aria-controls="nav-sheet" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>
            {open ? <IconClose size={18} /> : <IconMenu />}
          </button>
        </div>
      </header>
      {/* Outside the header: children of a backdrop-filter element do not layer reliably over the page. */}
      <nav id="nav-sheet" className="nav-sheet" hidden={!open} aria-label="Main">
        {links}
        <Link className="btn btn-primary btn-lg" to="/new">
          Upload scans
        </Link>
        <ModeStatus info={info} />
      </nav>
    </>
  );
}

export function SiteFooter({ info }: { info: ApiInfo | null }) {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-row">
          <span>Postoperative glioma segmentation · research prototype{info ? ` v${info.app_version}` : ""}</span>
          <nav aria-label="Footer">
            <Link to="/about">Model card</Link>
            <a href={REPO} target="_blank" rel="noreferrer">
              Paper &amp; code <IconArrowUpRight size={12} />
            </a>
            <a href={DATASET} target="_blank" rel="noreferrer">
              MU-Glioma-Post dataset <IconArrowUpRight size={12} />
            </a>
          </nav>
        </div>
        <p className="footer-team">{TEAM.join(", ")}</p>
      </div>
    </footer>
  );
}

/** The required disclaimer: always on screen, at the very bottom. */
export function DisclaimerBar({ info }: { info: ApiInfo | null }) {
  return (
    <div className="disclaimer-bar" role="note">
      {info?.mode === "demo" && <span className="chip chip-demo chip-dot">Demo · no model</span>}
      <span>
        <b>Research prototype.</b> Trained and internally validated on the MU-Glioma-Post dataset only. Not a medical device, not for diagnosis or
        treatment decisions.
      </span>
    </div>
  );
}

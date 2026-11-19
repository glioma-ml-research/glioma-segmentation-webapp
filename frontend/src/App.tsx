import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { DisclaimerBar, SiteFooter, SiteNav } from "./components/SiteChrome";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequireAuth } from "./lib/auth";
import { useApiInfo } from "./lib/server";
import About from "./pages/About";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import Signup from "./pages/Signup";
import Upload from "./pages/Upload";

// The viewer pulls in three.js; load it only when a result is opened.
const Compare = lazy(() => import("./pages/Compare"));
const Viewer = lazy(() => import("./pages/Viewer"));
const Results = lazy(() => import("./pages/Results"));
const Account = lazy(() => import("./pages/Account"));
const Team = lazy(() => import("./pages/Team"));
const Report = lazy(() => import("./pages/Report"));

/** New page: start at the top. Link with a #hash: scroll to that section. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      // Wait a frame so the target page has rendered.
      const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return () => cancelAnimationFrame(frame);
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);
  return null;
}

function ViewerFallback() {
  return (
    <main className="viewer-app">
      <div className="viewer-state">
        <div className="loader">
          <div className="spinner" aria-hidden="true" />
          <ol>
            <li className="current">Loading the viewer</li>
          </ol>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const { info } = useApiInfo();
  const { pathname } = useLocation();
  const app = pathname.startsWith("/viewer");

  return (
    <div className="site" data-mode={app ? "app" : "page"}>
      <ScrollManager />
      {!app && <SiteNav info={info} />}
      <div className="site-main">
        <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<ViewerFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/new" element={<Upload />} />
            <Route path="/viewer/:jobId" element={<Viewer />} />
            <Route path="/compare/:baseline/:followup" element={<RequireAuth><Compare /></RequireAuth>} />
            <Route path="/about" element={<About />} />
            <Route path="/report/:jobId" element={<Report />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              path="/results"
              element={
                <RequireAuth>
                  <Results />
                </RequireAuth>
              }
            />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Account />
                </RequireAuth>
              }
            />
            <Route
              path="/team"
              element={
                <RequireAuth admin>
                  <Team />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </div>
      {!app && <SiteFooter info={info} />}
      <DisclaimerBar info={info} />
    </div>
  );
}

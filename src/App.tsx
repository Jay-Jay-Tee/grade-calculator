import { useEffect, useMemo, useRef, useState } from "react";
import { summarize } from "./engine/calc";
import { cs1101sFixture } from "./engine/fixtures";
import { cloneBands } from "./engine/bands";
import {
  addCourse,
  defaultPreset,
  deleteCourse,
  exportCourse,
  mutate,
  newCourse,
  parseCourseFile,
  templateFrom,
  useAppState,
} from "./state/store";
import { CourseView } from "./ui/CourseView";
import { fmtPct } from "./ui/format";
import { ImportModal } from "./ui/ImportModal";
import { CourseBandsModal, SettingsModal } from "./ui/SettingsModal";
import { Tutorial } from "./ui/Tutorial";

type Dialog = null | "settings" | "import" | "bands" | "guide";

function useResolvedTheme(theme: "system" | "light" | "dark") {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

export default function App() {
  const s = useAppState();
  // First visit with nothing set up: open the guide.
  const [dialog, setDialog] = useState<Dialog>(() => (!s.seenTutorial && s.courses.length === 0 ? "guide" : null));
  const [drawer, setDrawer] = useState(false);
  const openFile = useRef<HTMLInputElement>(null);
  useResolvedTheme(s.theme);

  const course = s.courses.find((c) => c.id === s.selectedId) ?? s.courses[0] ?? null;
  const currents = useMemo(() => new Map(s.courses.map((c) => [c.id, summarize(c, false).current])), [s.courses]);

  const select = (id: string) => {
    mutate((st) => void (st.selectedId = id));
    setDrawer(false);
  };

  const download = (name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w.-]+/g, "_") || "course"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const loadExample = () => {
    const c = cs1101sFixture();
    c.bands = cloneBands(defaultPreset(s).bands);
    c.presetId = s.defaultPresetId;
    addCourse(c);
    setDrawer(false);
  };

  return (
    <div className={`app ${drawer ? "drawer-open" : ""}`}>
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label="Courses" onClick={() => setDrawer((v) => !v)}>
          ☰
        </button>
        <div className="brand">What-If Grades</div>
        <span className="grow" />
        <button className="btn ghost" onClick={() => setDialog("guide")}>
          Guide
        </button>
        <button className="btn ghost" onClick={() => setDialog("settings")}>
          Settings
        </button>
      </header>

      <aside className="sidebar">
        <div className="sidebar-head">
          <span>Courses</span>
          <button
            className="btn small primary"
            onClick={() => {
              addCourse(newCourse());
              setDrawer(false);
            }}
          >
            + New
          </button>
        </div>
        <nav className="course-list">
          {s.courses.map((c) => (
            <button key={c.id} className={`course-link ${course?.id === c.id ? "active" : ""}`} onClick={() => select(c.id)}>
              <span className="ellipsis">{c.name || "Untitled"}</span>
              <span className="pill">{fmtPct(currents.get(c.id) ?? null)}</span>
            </button>
          ))}
          {s.courses.length === 0 && <p className="hint pad">No courses yet.</p>}
        </nav>
        <div className="sidebar-foot">
          <button
            className="btn small"
            onClick={() => {
              setDialog("import");
              setDrawer(false);
            }}
          >
            Import grades
          </button>
          <button className="btn small" onClick={() => openFile.current?.click()}>
            Open course file
          </button>
          <button className="btn small ghost" onClick={loadExample}>
            Load example
          </button>
          <input
            ref={openFile}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                addCourse(parseCourseFile(await f.text()));
                setDrawer(false);
              } catch (err) {
                alert(`Couldn't open that file. ${err instanceof Error ? err.message : ""}`);
              }
            }}
          />
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} />

      <main className="main">
        {course ? (
          <CourseView
            key={course.id}
            course={course}
            whatIf={s.whatIfMode}
            onImport={() => setDialog("import")}
            onBands={() => setDialog("bands")}
            onExport={() => download(course.name, exportCourse(course))}
            onTemplate={() => addCourse(templateFrom(course))}
            onDelete={() => confirm(`Delete ${course.name}? This can't be undone.`) && deleteCourse(course.id)}
          />
        ) : (
          <div className="welcome">
            <h1>Work out your grade when the LMS won't.</h1>
            <p>Set up how a course is weighted, add your marks, and see what you need on what's left.</p>
            <div className="row gap center wrap">
              <button className="btn primary" onClick={() => setDialog("import")}>
                Import grades or syllabus
              </button>
              <button className="btn" onClick={() => addCourse(newCourse())}>
                Start from scratch
              </button>
              <button className="btn ghost" onClick={loadExample}>
                Try an example
              </button>
            </div>
            <p>
              <button className="link" onClick={() => setDialog("guide")}>
                New here? Read the 2-minute guide
              </button>
            </p>
          </div>
        )}
      </main>

      {dialog === "guide" && (
        <Tutorial
          hasExample={s.courses.some((c) => c.name === "CS1101S")}
          onLoadExample={loadExample}
          onClose={() => {
            setDialog(null);
            if (!s.seenTutorial) mutate((st) => void (st.seenTutorial = true));
          }}
        />
      )}
      {dialog === "settings" && <SettingsModal onClose={() => setDialog(null)} />}
      {dialog === "import" && <ImportModal current={course} onClose={() => setDialog(null)} onOpenSettings={() => setDialog("settings")} />}
      {dialog === "bands" && course && <CourseBandsModal course={course} onClose={() => setDialog(null)} />}
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

type Step = { title: string; body: ReactNode };

const STEPS: Step[] = [
  {
    title: "What this does",
    body: (
      <>
        <p>
          When your LMS says <i>"Calculation of totals has been disabled"</i>, this app works the total out for you.
        </p>
        <p>You tell it how the course is weighted and what marks you have. It tells you:</p>
        <ul>
          <li>your percentage on what's been marked so far</li>
          <li>the best grade you can still get</li>
          <li>the score you need on what's left for each grade</li>
        </ul>
        <p className="hint">Everything stays in this browser. No account needed.</p>
      </>
    ),
  },
  {
    title: "1. Add sections and weights",
    body: (
      <>
        <p>
          A section is one weighted part of the course, like "Midterm 20%". Tap <b>+ New</b> to make a course, then{" "}
          <b>Add section</b>. Set its weight and how its items combine:
        </p>
        <dl className="tut-defs">
          <dt>Total marks</dt>
          <dd>All marks added up, then divided by the total possible. Use this by default.</dd>
          <dt>Average of items</dt>
          <dd>Each item counts equally, whatever it's out of.</dd>
          <dt>Best N count</dt>
          <dd>Only your best n items count, like "best 3 of 4".</dd>
          <dt>Drop lowest</dt>
          <dd>Your lowest k items are ignored.</dd>
        </dl>
        <div className="tut-tip">
          <b>Pooled items:</b> "RA1, PA1, RA2, PA2 at 8% each, best 3 of 4 count" is <i>one</i> section: weight 24 (8 x 3),
          rule Best N, best 3 of 4.
        </div>
      </>
    ),
  },
  {
    title: "2. Add your marks",
    body: (
      <>
        <p>
          Tap <b>+ Item</b> in a section and fill in the score and what it's out of.
        </p>
        <div className="tut-demo items">
          <div className="item-row">
            <span className="tut-cell">RA2</span>
            <span className="tut-cell r">57</span>
            <span className="tut-cell r">72</span>
            <span className="r item-pct">79%</span>
            <span />
          </div>
          <div className="item-row">
            <span className="tut-cell">Final</span>
            <span className="tut-cell r muted">-</span>
            <span className="tut-cell r">100</span>
            <span className="r item-pct">-</span>
            <span />
          </div>
        </div>
        <ul>
          <li>
            <b>Not marked yet?</b> Leave the score blank. It counts as "still to come".
          </li>
          <li>
            <b>Best N sections</b> show items that don't count right now as <span className="tag">dropped</span>.
          </li>
          <li>
            <b>Excused from something?</b> Tap <b>EX</b> on the item. It then counts nowhere, as if it didn't exist.
          </li>
          <li>
            <b>Know how many are coming?</b> Set "best 3 of <b>4</b>". Items you haven't added yet still count as planned.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "3. Read the summary",
    body: (
      <>
        <dl className="tut-defs">
          <dt>Current</dt>
          <dd>How you're doing on what's been marked. 62.67 points out of 70 marked so far = 89.5%.</dd>
          <dt>Max possible</dt>
          <dd>What you'd get with full marks on everything left.</dd>
          <dt>Locked</dt>
          <dd>Points you already have and can't lose, even with 0 on the rest.</dd>
          <dt>Band now</dt>
          <dd>The grade your current % falls in.</dd>
          <dt>Projected</dt>
          <dd>Your result including what-if scores (step 5).</dd>
        </dl>
      </>
    ),
  },
  {
    title: "4. What do I need?",
    body: (
      <>
        <p>The <b>What do I need?</b> panel lists every grade with the average you need on everything that's left.</p>
        <ul className="needs tut-demo">
          <li className="need needed">
            <span className="need-band">A+</span>
            <span className="need-min">90%</span>
            <span className="need-val">
              91.1% <span className="raw">91.09/100</span>
            </span>
          </li>
          <li className="need needed">
            <span className="need-band">A</span>
            <span className="need-min">85%</span>
            <span className="need-val">
              74.4% <span className="raw">74.42/100</span>
            </span>
          </li>
          <li className="need secured">
            <span className="need-band">C+</span>
            <span className="need-min">60%</span>
            <span className="need-val">Already secured</span>
          </li>
        </ul>
        <ul>
          <li>
            <b>Already secured</b> means you get at least that grade even with 0 on the rest.
          </li>
          <li>
            <b>Out of reach</b> means you can't get it even with full marks.
          </li>
          <li>
            If only <b>one item</b> is left (say the Final), you also see the exact marks you need on it.
          </li>
          <li>
            Scores are shown to two decimals, so 74.42% means you need at least that. If your course rounds the final % (84.5%
            counts as 85%), set that in <b>Grade bands</b> and the scores allow for it.
          </li>
          <li>Best N and drop-lowest rules are taken into account, so a score that would be dropped doesn't count against you.</li>
        </ul>
      </>
    ),
  },
  {
    title: "5. Try what-ifs",
    body: (
      <>
        <p>
          Turn on <b>What-if mode</b>. Each item gets a purple box for a made-up score.
        </p>
        <ul>
          <li>
            <b>Projected</b> shows your result with those scores.
          </li>
          <li>
            <b>What do I need?</b> treats them as done. Put 80 on the next quiz to see what that leaves for the Final.
          </li>
          <li>
            <b>Current</b> always uses real marks only, so you never mix up real and made-up scores.
          </li>
        </ul>
        <p className="hint">Turn the mode off to hide what-ifs. They're kept for next time.</p>
      </>
    ),
  },
  {
    title: "6. Import instead of typing",
    body: (
      <>
        <p>
          Tap <b>Import</b> and paste or drop in any of these. You can add several at once:
        </p>
        <ul>
          <li>your Canvas grades page (select all, copy, paste)</li>
          <li>the syllabus or lecture slide with the weighting</li>
          <li>a results email</li>
          <li>screenshots and PDFs</li>
        </ul>
        <p>
          You then get a <b>review screen</b>. Fix anything wrong, drag items between sections, untick rows you don't want.{" "}
          <b>Nothing changes until you tap Apply.</b>
        </p>
        <dl className="tut-defs">
          <dt>
            <span className="flag suspicious_zero">0 looks off</span>
          </dt>
          <dd>A 0 while the class low is above 0. Usually a what-if or a missing submission, not a real 0.</dd>
          <dt>
            <span className="flag unmatched_item">Not in a section</span>
          </dt>
          <dd>Pick a section for it, or it's skipped.</dd>
        </dl>
        <div className="tut-tip">
          <b>Screenshots and scanned PDFs need a free Gemini key.</b> Pasted text works without one. To get a key:
          <ol>
            <li>
              Open{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Google AI Studio
              </a>{" "}
              and sign in with Google.
            </li>
            <li>
              Tap <b>Create API key</b> and copy it.
            </li>
            <li>
              Paste it in <b>Settings</b> and tap <b>Save key</b>. The app checks it straight away.
            </li>
          </ol>
          You can pick the model in Settings too. Flash is the default; Flash-Lite gets more free requests per day. The key stays in
          this browser.
        </div>
      </>
    ),
  },
  {
    title: "7. Grade bands",
    body: (
      <>
        <p>
          The default cutoffs are 90% and above for A+, 85% for A, 80% for A-, and so on down to 45% for D, with F below that.
        </p>
        <ul>
          <li>
            <b>Change a cutoff right in the "What do I need?" panel.</b> Tap the number next to a grade and type a new one.
          </li>
          <li>
            <b>Grade bands</b> (under the course name) lets you rename, add or remove grades, or use a preset.
          </li>
          <li>
            <b>Settings</b> holds presets, like "Strict 90/80/70", that new courses start from.
          </li>
        </ul>
        <p className="hint">Cutoffs must go strictly down the list. You'll see a message if they don't.</p>
      </>
    ),
  },
  {
    title: "8. Curved courses",
    body: (
      <>
        <p>
          Some courses grade on a curve: your grade depends on where you are in the class, not a fixed percentage. Switch the course
          to <b>Curved</b> at the top of the "What do I need?" panel.
        </p>
        <ul>
          <li>
            Add the <b>class stats</b> under each item (Low, quartiles, median, High). Importing a Canvas page fills them in for you.
          </li>
          <li>
            You get an estimated <b>class standing</b>, like "Top 18%", with a likely range (say 15-22%), and the grade that
            usually goes with it. The range is there because we can't know how closely the class's results on different tests
            line up.
          </li>
          <li>
            Cutoffs become "top % of class": A+ for the top 5%, A for the top 25%, and so on. Rough rule: above the upper quartile on
            everything is usually an A. Edit them to match your course.
          </li>
          <li>
            "What do I need?" shows where to place on what's left, like "Top 22% on the rest (above the median)".
          </li>
        </ul>
        <div className="tut-tip">
          Curves rarely match the absolute cutoffs exactly, so the absolute result is always shown next to the curved one as a
          baseline. Treat the curved grade as an estimate.
        </div>
      </>
    ),
  },
  {
    title: "9. Keep and reuse",
    body: (
      <>
        <ul>
          <li>Changes save as you type, in this browser. Values that can't be right, like a negative score, turn red with a message.</li>
          <li>
            Courses save in this browser automatically. To move one to another device or share it with a friend, tap{" "}
            <b>Download course</b> (under the course name), then <b>Load course from file</b> (in the course list) on the
            other side.
          </li>
          <li>
            <b>Duplicate as template</b> copies a course without marks. Handy when you retake it or a
            friend takes it next semester.
          </li>
        </ul>
        <p>That's it. Load the example to see a finished course.</p>
      </>
    ),
  },
];

export function Tutorial({ onClose, onLoadExample, hasExample }: { onClose: () => void; onLoadExample: () => void; hasExample: boolean }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <Modal
      title="Guide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          <span className="grow tut-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((_, j) => (
              <button key={j} className={`dot ${j === i ? "on" : ""}`} aria-label={`Go to step ${j + 1}`} onClick={() => setI(j)} />
            ))}
          </span>
          {last ? (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <button className="btn primary" onClick={() => setI(i + 1)}>
              Next
            </button>
          )}
        </>
      }
    >
      <div className="tutorial">
        <h3 className="tut-title">{step.title}</h3>
        {step.body}
        {(i === 0 || last) && !hasExample && (
          <button
            className="btn"
            onClick={() => {
              // Close so the course is visible (the guide covers the whole screen on phones).
              onLoadExample();
              onClose();
            }}
          >
            Load the example course
          </button>
        )}
        {(i === 0 || last) && hasExample && <p className="hint small">The example course (CS1101S) is in your course list.</p>}
      </div>
    </Modal>
  );
}

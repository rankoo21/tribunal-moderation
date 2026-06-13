import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getConfig,
  readTopic,
  readPosts,
  readStats,
  submitPost,
  applyWalletAccount,
} from './genlayer.js';
import { connectWallet, hasWallet, onAccountsChanged } from './wallet.js';

const VERDICT_TAG = {
  approved: 'ADMITTED',
  toxic: 'TOXIC',
  'off-topic': 'OUT OF SCOPE',
  spam: 'SOLICITATION',
  other: 'DISMISSED',
};

const DELIB_STEPS = [
  'Summoning validator jury',
  'Reading submission into record',
  'Each validator renders an opinion',
  'Reconciling for consensus',
  'Awaiting majority ruling',
];

function short(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);

  const [topic, setTopic] = useState('');
  const [posts, setPosts] = useState([]);
  const [stats, setStats] = useState({ total: 0, approved: 0 });

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [step, setStep] = useState(0);
  const [clock, setClock] = useState(0);
  const timer = useRef(null);

  const [wallet, setWallet] = useState(null);
  const [walletErr, setWalletErr] = useState(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    try {
      setConfig(getConfig());
    } catch (err) {
      setConfigError(err.message);
    }
  }, []);

  useEffect(() => {
    return onAccountsChanged((addr) => {
      if (addr) {
        applyWalletAccount(addr, window.ethereum);
        setWallet(addr);
      } else {
        setWallet(null);
      }
      setConfig(getConfig());
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoadingFeed(true);
    try {
      const t = await readTopic();
      setTopic(t);
      const p = await readPosts();
      setPosts(p);
      const s = await readStats();
      setStats(s);
    } catch (err) {
      setStatus({ kind: 'error', text: `Could not read the chain — ${err.message}` });
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    if (config && !configError) refresh();
  }, [config, configError, refresh]);

  // deliberation step + elapsed clock while a trial runs
  useEffect(() => {
    if (submitting) {
      const t0 = Date.now();
      timer.current = setInterval(() => {
        setClock(Math.floor((Date.now() - t0) / 1000));
        setStep((i) => (i + 1) % DELIB_STEPS.length);
      }, 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      setStep(0);
      setClock(0);
    }
    return () => timer.current && clearInterval(timer.current);
  }, [submitting]);

  async function onConnect() {
    setWalletErr(null);
    setConnecting(true);
    try {
      const { address, provider } = await connectWallet();
      applyWalletAccount(address, provider);
      setWallet(address);
      setConfig(getConfig());
    } catch (err) {
      setWalletErr(err.message);
    } finally {
      setConnecting(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setSubmitting(true);
    setStatus({ kind: 'pending' });
    try {
      await submitPost(value);
      setText('');
      await refresh();
      const newest = (await readPosts())[0];
      if (newest) setStatus({ kind: newest.approved ? 'pass' : 'fail', verdict: newest });
    } catch (err) {
      setStatus({ kind: 'error', text: `Mistrial — ${err.message}` });
    } finally {
      setSubmitting(false);
    }
  }

  if (configError) {
    return (
      <>
        <Field />
        <div className="grid min-h-full place-items-center p-6">
          <div className="frame ticked max-w-lg p-8 animate-rise">
            <p className="eyebrow">System · halted</p>
            <h1 className="display mt-3 text-3xl">Court is not in session.</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">{configError}</p>
          </div>
        </div>
      </>
    );
  }

  const rejected = Math.max(stats.total - stats.approved, 0);
  const rate = stats.total > 0 ? Math.round((stats.approved / stats.total) * 100) : 0;
  const mm = String(Math.floor(clock / 60)).padStart(2, '0');
  const ss = String(clock % 60).padStart(2, '0');

  return (
    <>
      <Field />

      {/* top rail */}
      <div className="hair-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="seal text-sm">§</span>
            <span className="text-[12px] font-semibold tracking-[0.3em]">TRIBUNAL</span>
            <span className="eyebrow ml-1 hidden sm:inline">· semantic moderation</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="eyebrow hidden md:inline">
              {config?.network} · 4221 · <span className="seal">ACTIVE</span>
            </span>
            <WalletButton wallet={wallet} connecting={connecting} onConnect={onConnect} />
          </div>
        </div>
      </div>

      {walletErr && (
        <div className="mx-auto max-w-5xl px-5 pt-4">
          <p className="frame px-4 py-2 text-xs text-accent">{walletErr}</p>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-5">
        {/* ── HERO ─────────────────────────────────────────────── */}
        <section className="grid gap-10 py-16 sm:py-24 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-8 animate-rise">
            <p className="eyebrow">Synthetic jurisdiction · GenLayer</p>
            <h1 className="display mt-5 text-[2.7rem] sm:text-[4.2rem]">
              Speech that settles
              <br />
              on <span className="italic seal">meaning.</span>
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted">
              A public board with no central moderator. Every submission stands trial before
              GenLayer&apos;s validators — an AI jury reads it, agrees on a verdict, and the
              ruling settles on-chain. No trusted admin, no off-chain judge, no rigid Solidity
              rulebook.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#file" className="btn btn-seal px-5 py-3">File a submission</a>
              <a href="#record" className="btn px-5 py-3">Read the record</a>
            </div>
          </div>

          {/* live monitor */}
          <div className="lg:col-span-4">
            <div className="frame ticked h-full p-5 animate-rise" style={{ animationDelay: '120ms' }}>
              <div className="flex items-center justify-between">
                <span className="eyebrow">Docket_monitor</span>
                <span className="flex items-center gap-1.5 text-[10px] tracking-widest text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> LIVE
                </span>
              </div>
              <div className="mt-5 space-y-4">
                <Reading label="Board" value={topic || '…'} mono={false} />
                <Reading label="Registry" value={short(config?.contractAddress)} />
                <Reading label="Signer" value={wallet ? short(wallet) : 'clerk key'} />
              </div>
              <div className="hair-t mt-5 grid grid-cols-3 pt-4 text-center">
                <Mini n={stats.total} l="filed" />
                <Mini n={stats.approved} l="passed" tone="text-[#9bbf7a]" />
                <Mini n={`${rate}%`} l="rate" />
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────── */}
        <section className="hair-t grid gap-px sm:grid-cols-3">
          <Module no="01" tag="PLAIN LANGUAGE" title="State your case">
            Submit prose, not code. The rules are written as natural language the jury can read
            and weigh.
          </Module>
          <Module no="02" tag="CONSENSUS" title="Validators adjudicate">
            Each validator independently runs an LLM over the submission and must agree on the
            verdict — not a single trusted oracle.
          </Module>
          <Module no="03" tag="ON-CHAIN" title="The ruling settles">
            PASS admits the post to the permanent record; FAIL strikes it. The outcome is written
            to chain state, forever.
          </Module>
        </section>

        {/* ── FILE ─────────────────────────────────────────────── */}
        <section id="file" className="hair-t py-16">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-4">
              <p className="eyebrow">Interactive · real on-chain</p>
              <h2 className="display mt-4 text-3xl">File &amp; try a submission.</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                One write, signed by your wallet. The jury may take a few minutes on Bradbury —
                real LLMs, real consensus.
              </p>
              <ol className="mt-6 space-y-2 text-xs text-muted">
                <li><span className="seal">01</span> State the submission for the record.</li>
                <li><span className="seal">02</span> Validators reach a verdict — pass or fail.</li>
                <li><span className="seal">03</span> The ruling is recorded on-chain.</li>
              </ol>
            </div>

            <form onSubmit={onSubmit} className="frame ticked p-6 lg:col-span-8">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Step 01 · submission</span>
                <span className={'text-[11px] tnum ' + (text.length > 1900 ? 'text-accent' : 'text-muted')}>
                  {text.length}/2000
                </span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                maxLength={2000}
                disabled={submitting}
                placeholder={`Address the board on "${topic || '…'}". Stay on-topic and civil — the jury is strict.`}
                className="mt-3 w-full resize-y border border-line bg-black/30 p-4 text-sm leading-relaxed text-ink outline-none transition placeholder:text-muted/50 focus:border-ink/40"
              />
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="eyebrow hidden sm:inline">
                  {wallet ? 'signing with wallet' : 'signing with clerk key'}
                </span>
                <button type="submit" disabled={submitting || !text.trim()} className="btn btn-seal px-6 py-3">
                  {submitting ? 'In session…' : 'Submit to jury →'}
                </button>
              </div>

              {status?.kind === 'pending' && (
                <Deliberation step={DELIB_STEPS[step]} mm={mm} ss={ss} />
              )}
              {status?.verdict && <Verdict v={status.verdict} />}
              {status?.kind === 'error' && (
                <p className="mt-4 border border-accent/40 bg-accent/10 px-4 py-3 text-xs text-accent">
                  {status.text}
                </p>
              )}
            </form>
          </div>
        </section>

        {/* ── RECORD ───────────────────────────────────────────── */}
        <section id="record" className="hair-t py-16">
          <div className="flex items-end justify-between">
            <div>
              <p className="eyebrow">Live on Bradbury</p>
              <h2 className="display mt-3 text-3xl">The court record.</h2>
            </div>
            <button onClick={refresh} disabled={loadingFeed} className="btn px-4 py-2">
              {loadingFeed ? 'Reading…' : '↻ From chain'}
            </button>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-px">
            <Tally n={stats.total} l="Cases filed" />
            <Tally n={stats.approved} l="Admitted" tone="text-[#9bbf7a]" />
            <Tally n={rejected} l="Struck down" tone="text-accent" />
          </div>

          <div className="mt-8">
            {loadingFeed && posts.length === 0 ? (
              <Skeleton />
            ) : posts.length === 0 ? (
              <div className="frame p-12 text-center">
                <p className="eyebrow">Empty docket</p>
                <p className="display mt-3 text-2xl text-muted">No case has been heard.</p>
              </div>
            ) : (
              <ol className="hair-t">
                {posts.map((p, i) => (
                  <Case key={p.index} p={p} i={i} />
                ))}
              </ol>
            )}
          </div>
        </section>

        <footer className="hair-t flex flex-col items-center justify-between gap-3 py-8 text-center sm:flex-row sm:text-left">
          <p className="eyebrow">© 2026 Tribunal · semantic moderation, settled on-chain</p>
          <a
            href={`https://explorer-bradbury.genlayer.com/`}
            target="_blank"
            rel="noreferrer"
            className="eyebrow hover:text-ink"
          >
            {short(config?.contractAddress)} · Bradbury 4221 ↗
          </a>
        </footer>
      </main>
    </>
  );
}

/* ── components ──────────────────────────────────────────────────────── */

function Field() {
  return (
    <>
      <div className="field" />
      <div className="rules" />
    </>
  );
}

function WalletButton({ wallet, connecting, onConnect }) {
  if (wallet) {
    return (
      <span className="flex items-center gap-2 border border-[#9bbf7a]/40 px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#9bbf7a]" />
        <span className="font-mono text-[11px] text-[#9bbf7a]">{short(wallet)}</span>
      </span>
    );
  }
  return (
    <button onClick={onConnect} disabled={connecting} className="btn px-4 py-1.5">
      {connecting ? 'Linking…' : hasWallet() ? 'Connect wallet' : 'Install wallet'}
    </button>
  );
}

function Reading({ label, value, mono = true }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={'mt-1 truncate text-sm text-ink ' + (mono ? 'font-mono' : 'display italic')}>
        {value}
      </p>
    </div>
  );
}

function Mini({ n, l, tone = 'text-ink' }) {
  return (
    <div>
      <div className={'tnum text-lg ' + tone}>{n}</div>
      <div className="eyebrow mt-0.5">{l}</div>
    </div>
  );
}

function Module({ no, tag, title, children }) {
  return (
    <div className="frame frame-hover hair-l p-7">
      <div className="flex items-center justify-between">
        <span className="display text-2xl text-muted/60">{no}</span>
        <span className="eyebrow">{tag}</span>
      </div>
      <h3 className="display mt-6 text-xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Tally({ n, l, tone = 'text-ink' }) {
  return (
    <div className="frame px-5 py-6 text-center">
      <div className={'display tnum text-4xl ' + tone}>{n}</div>
      <div className="eyebrow mt-2">{l}</div>
    </div>
  );
}

function Deliberation({ step, mm, ss }) {
  return (
    <div className="mt-4 border border-line bg-black/30 p-4 animate-rise">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Jury_deliberating</span>
        <span className="tnum text-[11px] text-muted">{mm}:{ss}</span>
      </div>
      <div className="scan-track mt-3 h-px bg-line" />
      <p className="mt-3 text-xs text-ink">
        {step}
        <span className="caret seal ml-1">▌</span>
      </p>
      <p className="eyebrow mt-1">validators on Bradbury · real LLM consensus</p>
    </div>
  );
}

function Verdict({ v }) {
  const pass = v.approved;
  return (
    <div className={'mt-4 border p-5 animate-rise ' + (pass ? 'border-[#9bbf7a]/40' : 'border-accent/50')}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Ruling entered</span>
        <span className={'verdict ' + (pass ? 'v-pass' : 'v-fail')}>{pass ? 'ADMITTED' : 'STRUCK DOWN'}</span>
      </div>
      <p className="display mt-3 text-2xl">
        {pass ? 'The submission joins the record.' : 'The submission is denied.'}
      </p>
      {v.reason && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          <span className="eyebrow">Opinion — </span>{v.reason}
        </p>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="hair-t">
      {[0, 1, 2].map((i) => (
        <div key={i} className="hair-b flex items-center gap-5 py-6">
          <div className="shimmer h-10 w-10" />
          <div className="flex-1">
            <div className="shimmer h-3 w-40" />
            <div className="shimmer mt-2 h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Case({ p, i }) {
  const pass = p.approved;
  return (
    <li
      className="hair-b grid grid-cols-[auto_1fr_auto] items-start gap-5 py-7 transition-colors hover:bg-ink/[0.015] animate-rise"
      style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
    >
      <div className="flex flex-col items-center">
        <span className="display text-2xl text-muted/50">{String(p.index + 1).padStart(2, '0')}</span>
        <span className="eyebrow mt-1">{VERDICT_TAG[p.category] ?? 'RULING'}</span>
      </div>

      <div>
        <p className="font-mono text-[11px] text-muted">{short(p.author)}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink">{p.text}</p>
        {p.reason && (
          <p className="mt-3 border-l border-line pl-3 text-xs leading-relaxed text-muted">
            <span className="eyebrow">Opinion — </span>{p.reason}
          </p>
        )}
      </div>

      <span className={'verdict shrink-0 ' + (pass ? 'v-pass' : 'v-fail')}>
        {pass ? 'PASS' : 'FAIL'}
      </span>
    </li>
  );
}

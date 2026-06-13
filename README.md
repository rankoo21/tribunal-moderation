# Tribunal — Semantic Content Moderation on GenLayer

Tribunal is a public community board with **no central moderator**. Anyone can
post; whether a post is admitted is decided not by an admin but by GenLayer's
validators. When a submission is filed, the validators independently classify it
with an LLM — *is it toxic? on-topic? spam?* — reach **consensus on the
verdict**, and the contract records the ruling deterministically. Each ruling
also updates an on-chain **reputation** score for the author.

It is a single GenLayer Intelligent Contract, live on **Testnet Bradbury
(chain 4221)**:

```
Contract: 0xac25788f412Ab7A271799262CdbD65F1Eca1bEC3
Explorer: https://explorer-bradbury.genlayer.com
```

## Why this needs GenLayer

Deciding whether a sentence is *"toxic"* or *"off-topic"* has no canonical byte
representation. To enforce it, a deterministic chain would have to bolt on the
very trust assumptions a smart contract is meant to remove:

- an **oracle** to decide what counts as toxic,
- an **off-chain moderator** to run the judgement and report a result,
- a **governance process** to keep the rulebook current.

GenLayer collapses all three into the protocol. Its validators execute
non-deterministic work — LLM inference — and still **agree by *equivalence*
rather than byte-equality**. Tribunal's state transitions intentionally depend
on:

- **LLM interpretation** — `gl.nondet.exec_prompt(...)` produces outputs that
  are never identical across nodes.
- **Semantic consensus** — validators run the same classification and vote on
  whether the leader's verdict is *equivalent*, via a custom validator function
  inside `gl.vm.run_nondet_unsafe(...)`.

That is the part a deterministic VM cannot reproduce without reintroducing a
trusted moderator, and it is the only part Tribunal puts on GenLayer.

## How a submission is judged

```
submit_post ──▶ (LLM classification + validator consensus) ──▶ ACCEPTED
                                                                   │
                                          post + verdict + reputation written on-chain
```

1. **`submit_post(text)`** records the submission. Input is sanitized
   (trimmed, length-capped at 2000 chars) and treated as untrusted.
2. Inside the non-deterministic block, the **leader** prompts the model to
   classify the post and returns `{ decision, category, reason }` as canonical
   JSON. **Validators re-run the same classification** and agree only on the
   **decision enum** (`APPROVE` / `REJECT`).
3. Once a majority agrees, the post, its verdict, and the author's updated
   reputation (+1 approved, −1 rejected) are written to chain state. If the
   majority rejects the leader, the transaction goes `UNDETERMINED` and **no
   state changes**.

Reads (`get_topic`, `get_posts`, `get_post`, `get_post_count`,
`get_approved_count`, `get_reputation`) are plain views.

### Consensus design

The only consensus-critical output is the **decision enum**. Heterogeneous
validator models will phrase a *reason* differently every time, so requiring
agreement on the free-form text would strand most posts in `Undetermined`.
Instead, validators agree only on the categorical `APPROVE` / `REJECT` judgment;
the `reason` and `category` are carried from the accepted leader result for
display. This follows GenLayer's *"Independent Verification Is Required"* rule —
the validator re-derives the decision itself rather than trusting that the
leader's JSON is merely well-formed.

### Storage model

Typed persistent fields only: `Address`, `str`, `u256`, `i32`, `bool`,
`DynArray`, `TreeMap`, and an `@allow_storage @dataclass` record (`Post`). No
Python `dict`/`list`, no bare `int`, no floats (GenLayer calldata cannot encode
them). Per-author reputation is a `TreeMap[Address, i32]`; posts are a
`DynArray[Post]`.

## Project layout

```
contract/content_moderation.py   # the Intelligent Contract
contract/tests/                  # fast in-memory tests (web/LLM mocked) + integration
scripts/                         # genlayer-js deploy / live-test / address-lookup
src/                             # frontend (Vite + React + genlayer-js + wallet)
gltest.config.yaml               # integration test / network config
.env.example                     # documented environment keys
```

## Build, test, deploy

The Intelligent Contract is written in Python for the GenVM and validated with
GenLayer's linter (`genvm-lint`) and test runner (`genlayer-test`). The frontend
is a Vite + React app wired to the chain through `genlayer-js`.

- **Lint** — AST safety checks plus SDK semantic validation of the contract.
- **Direct-mode tests** — fast in-memory unit and consensus tests with web/LLM
  calls mocked at the boundary (11 passing).
- **Integration tests** — run against real validators and real LLMs on a
  network.
- **Deploy** — published to Bradbury via `genlayer-js`; the signing key is read
  from a git-ignored `.env` and is never printed.

Deploys are funded from a Bradbury account via the public
[faucet](https://testnet-faucet.genlayer.foundation).

## Frontend

`src/` is a static React app (Vite + `genlayer-js`). Reads run **wallet-free
directly against the chain** — the Bradbury RPC is CORS-open, so no backend or
indexer is required. Writes (`submit_post`) are signed through a connected
wallet on chain 4221 (MetaMask via `src/wallet.js`), or a dev key from `.env`
when no wallet is present. Because the contract does not store originating
transaction hashes, the client polls the submitted transaction through
consensus (`PROPOSING → COMMITTING → ACCEPTED`) before showing the on-chain
verdict.

Nothing is simulated — there is no `setTimeout` fake verdict and no local
keyword check. Every decision comes from the deployed Intelligent Contract.

## Engineering notes (verified on Bradbury)

Hard-won specifics that are easy to get wrong:

- **Pin a concrete GenVM runner hash.** Networks and the linter's SDK loader are
  version-specific; an unpinned or mismatched runner is rejected. The contract
  pins a known-good `py-genlayer` runner in its first-line header.
- **Storage is not readable inside a non-deterministic block.** Copy what the
  block needs into locals beforehand (e.g. `topic = self.topic`) and write
  results back only *after* consensus returns.
- **Agree on a coarse, categorical signal**, never free-form LLM text, or
  consensus stalls. Tribunal agrees on `APPROVE`/`REJECT` and carries the prose
  reason from the accepted result.
- **`validator_fn` receives a `gl.vm.Return`, not the raw value.** Unwrap
  `leader_result.calldata` and re-derive the decision; treat anything else
  (e.g. an exception) as a rejection.
- **Treat all user input as untrusted.** The post is wrapped in `<post>…</post>`
  delimiters and the model is instructed to ignore any instructions embedded in
  the text (prompt-injection hardening).
- **Bradbury rulings take minutes, not seconds.** Each validator runs a real
  LLM; the client and scripts poll patiently through the consensus stages
  instead of relying on a short default timeout.

## Roadmap

Tribunal today ships the part that can only exist on GenLayer — semantic
moderation and on-chain reputation. Planned depth:

- **Reputation-gated posting** — require a minimum reputation (or a small bond)
  to post, slashing it on rejection to deter spam.
- **Appeal window** — an on-chain appeal path that re-runs consensus with more
  validators for contested rulings.
- **Configurable rulebooks** — let a board owner set the community rules as
  prose at deploy time, per topic.
- **Doctrine memory** — fold recurring rulings into deterministic rulelets so
  obvious cases settle without an LLM call, reserving inference for novel posts.
- **Multi-board registry** — a factory contract spawning topic-specific boards
  that share a global reputation graph.

## Links

- Contract on Bradbury: [`0xac25788f…1bEC3`](https://explorer-bradbury.genlayer.com/)
- GenLayer docs: https://docs.genlayer.com

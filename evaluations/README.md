# Evaluations

These test something the unit suite cannot: whether a model can actually *drive* this server. The
tests prove the tools work. An evaluation asks whether an LLM with no other context, holding only
the tool list and the descriptions, can find the right operation among 316 of them and get the shape
of the call right.

That is the specific risk this server's design takes on. One tool per resource with an `operation`
enum keeps the tool count manageable, but it means every call starts with a choice between 63
generated resource tools (plus three hand-written tools) and then a choice between up to 14
operations inside one — and the tool descriptions and
`ivedaai_get_schema` are the only guidance a model has. If that guidance is thin, the failure is not
an error, it is a confident call against the wrong endpoint.

## What is here

`tool-navigation.xml` — ten questions whose answers are fixed by the bundled
`resources/openapi.json`.

Being answerable from the bundled spec is the point, not a compromise: it means the whole file runs
against a server started with dummy credentials, makes no HTTP request to anybody, creates nothing,
and gives the same result on every machine. It is also where the real difficulty lives for this
server — the questions are the ones an integrator actually asks before writing any code. *What does
this API let me create? Which call starts a stream? What does the request body have to contain?*

They are written to resist keyword matching. None names the definition it is about; several have
decoys in the spec — the coordinate-pair question has both `Point` and `VoPoint` to choose between,
and only following the `$ref` chain distinguishes them.

## Running them

The harness is `scripts/evaluation.py` from Anthropic's `mcp-builder` skill; it is not vendored
here. With that skill installed:

```bash
pip install anthropic mcp
export ANTHROPIC_API_KEY=...

python <skill>/scripts/evaluation.py \
  -t stdio -c node -a dist/index.js \
  -e IVEDAAI_BASE_URL=http://127.0.0.1:1 \
  -e IVEDAAI_USERNAME=unused -e IVEDAAI_PASSWORD=unused \
  -o evaluations/report.md \
  evaluations/tool-navigation.xml
```

`npm run build` first. The credentials are deliberately junk and the base URL deliberately
unreachable — nothing here should be reaching a deployment, and pointing it at one that cannot
answer is the cheapest way to be sure.

Read the report for the agent's own account of how it navigated the tools. That commentary is worth
more than the score: a wrong answer tells you a question was hard, but the reasoning tells you
*which description was misleading*, which is the thing you can fix.

## Keeping the answers true

```bash
npm run verify:evals
```

Every answer is a fact about the shipped spec, so a spec upgrade can quietly turn the whole file
into a set of wrong answers — and that failure would look like the model getting worse rather than
the fixture going stale. `scripts/verify-evaluation.ts` recomputes each answer from
`resources/openapi.json` and fails if one has drifted. CI runs it.

It checks the arithmetic under the questions, not the questions themselves. It also fails when a
question's *premise* stops holding — if the two untestable trigger types stop sharing a category, or
the activation call grows a second query parameter, the question is broken even though no answer
changed, and the script says so rather than quietly passing.

**Do not edit the script to agree with the file.** Deriving from the spec is the only thing making
the file trustworthy.

## What these do not cover

**No question here touches live data.** Every answer comes from the bundled document, so nothing in
this file exercises the paths that actually carry risk on a real deployment: pagination across a
collection with real depth, an operation whose live behaviour contradicts its spec, a truncated
response, a 500, or a partial write. Those findings require controlled deployment testing and are
not part of this public, deployment-independent fixture.

That gap is not an oversight, it is a missing prerequisite: a live-data set needs a deployment whose
contents are stable enough that answers stay correct, and it has to be written by someone who can
run read-only calls against it and verify each answer by solving the question. Nobody has had that
here yet.

When someone does, it belongs in a second file rather than mixed into this one, because it has
different properties: it needs credentials, it can only run where that deployment is reachable, and
its answers rot when the data changes. Anchor its questions on records that are closed or
historical, and record which deployment it was written against.

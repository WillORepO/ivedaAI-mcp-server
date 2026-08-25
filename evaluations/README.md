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
python -m venv .evalenv
.evalenv/Scripts/python -m pip install "anthropic>=0.39.0" "mcp>=1.1.0,<2"
export ANTHROPIC_API_KEY=...

PYTHONIOENCODING=utf-8 .evalenv/Scripts/python <skill>/scripts/evaluation.py \
  -t stdio -c node -a dist/index.js \
  -e IVEDAAI_BASE_URL=http://127.0.0.1:1 IVEDAAI_USERNAME=unused IVEDAAI_PASSWORD=unused \
  -m claude-sonnet-5 \
  -o evaluations/report.md \
  evaluations/tool-navigation.xml
```

`npm run build` first. The credentials are deliberately junk and the base URL deliberately
unreachable — nothing here should be reaching a deployment, and pointing it at one that cannot
answer is the cheapest way to be sure.

Four details in that command are not decoration. Each was a failed run before it was a flag:

- **One `-e`, carrying all three variables.** The harness declares `-e` with `nargs="+"`, so a
  repeated `-e` does not accumulate — argparse overwrites, and only the last survives. Passing
  them separately delivers `IVEDAAI_PASSWORD` alone, the server exits for want of a base URL, and
  the harness reports `McpError: Connection closed`, which says nothing about the cause.
- **`mcp<2`.** The skill's own `requirements.txt` asks for `mcp>=1.1.0`, which now resolves to
  2.x, where `streamablehttp_client` has been renamed `streamable_http_client`. Its
  `connections.py` imports the old name and fails at import, before any of this repository is
  involved.
- **`PYTHONIOENCODING=utf-8`.** The harness prints emoji. On a Windows console defaulting to
  cp1252 it dies in `print()` on the first one.
- **`-m`.** The harness defaults to `claude-3-7-sonnet-20250219`. Name the model you actually
  mean: a score means nothing without knowing which model produced it, which is also why it
  belongs in the report header.

A venv rather than a global install, because of `mcp<2`: pinning that globally would hold back
anything else on the machine using the MCP Python SDK. Keep the path short — a deep one
overruns Windows' 260-character limit while unpacking `pywin32`.

### The harness itself needs four fixes

The flags above get the command accepted. They are not enough to get a **score**: as shipped,
`scripts/evaluation.py` and `connections.py` fail on any current model. All four were hit in one
sitting, and three of them produce a plausible-looking result rather than an error, which is why
they are worth writing down.

1. **Parallel tool calls are dropped.** The loop takes only the first `tool_use` block
   (`next(block for block in ...)`) and answers it with one `tool_result`. Any model that calls
   tools in parallel gets a 400: *`tool_use` ids were found without `tool_result` blocks
   immediately after*. Collect every block and return all results, in order, in one message.
2. **Tool results are unserializable.** `connections.py` returns `result.content` — a list of
   `TextContent` objects — which the caller feeds to `json.dumps()`. **Every tool call fails**
   with `Object of type TextContent is not JSON serializable`, the model falls back to answering
   from tool descriptions alone, and the report still prints a confident accuracy figure. This is
   the dangerous one: it scores something real, just not what you think you measured. Map each
   block to its `.text` first.
3. **`max_tokens=4096` truncates.** Once tool results actually carry data the answers grow, a
   turn ends with no text block, and `extract_xml_content` dies on `None`. Raise the ceiling, and
   report a turn that produced no text as what it is rather than scoring it as a wrong answer.
4. **The report cannot be written.** `args.output.write_text(report)` uses the locale encoding;
   the report contains emoji. On Windows every task runs, costs real tokens, and the results are
   discarded by a `UnicodeEncodeError` on the last line of the program. Pass
   `encoding="utf-8"`.

The pattern is consistent: written against an older model, never run on Windows, and failing in
ways that yield a number instead of an error. Treat a score from an unpatched harness as
unverified — check the per-task tool-call counts and the agent's own summary before believing
it. A run where every tool call failed still reported 6/10 here.

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

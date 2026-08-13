/**
 * Turning a failed `fetch` into something a person can act on.
 *
 * Node reports every transport-level failure as `TypeError: fetch failed`. The
 * real reason is on `err.cause`, and both call sites used to rethrow the
 * TypeError untouched. Testing an installed build against three unrelated
 * misconfigurations produced three identical messages:
 *
 *   wrong hostname          ->  fetch failed   (cause: ENOTFOUND)
 *   https to an http port   ->  fetch failed   (cause: DEPTH_ZERO_SELF_SIGNED_CERT)
 *   nothing listening       ->  fetch failed   (cause: ECONNREFUSED)
 *
 * Those are the three most likely mistakes on a first run, and they were
 * indistinguishable. Worse, the model receiving "fetch failed" has nothing to
 * work with and no reason not to simply retry.
 *
 * The contrast that motivated this: a missing IVEDAAI_BASE_URL already exits
 * with a message naming the variable and giving an example. Once the process is
 * up, that standard was not being met.
 */

/** The cause chain, outermost first. Node nests these more than one deep. */
function causeChain(err: unknown, limit = 4): Error[] {
  const out: Error[] = [];
  let cur: unknown = err;
  while (cur instanceof Error && out.length < limit) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

/**
 * Advice keyed on the error code, or undefined when we have nothing useful.
 *
 * Only codes where the next step is genuinely unambiguous get advice. A wrong
 * guess here is worse than silence: it sends someone to check the thing that
 * was not broken.
 */
function adviceFor(code: string, message: string): string | undefined {
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The hostname in IVEDAAI_BASE_URL did not resolve. Check it for a typo, and that this machine can reach the deployment's DNS.";
    case "ECONNREFUSED":
      return "Nothing is listening on that host and port. Check the port in IVEDAAI_BASE_URL, and that the IvedaAI server is running.";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "No route to that host — typically a VPN that is not connected, or a firewall.";
    case "ECONNRESET":
      return "The connection was closed mid-request. If IVEDAAI_BASE_URL uses https:// and the deployment only serves plain HTTP, try http:// instead.";
    case "ETIMEDOUT":
      return "The connection attempt timed out before the server answered. Check the host and port, and any firewall between here and it.";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "CERT_HAS_EXPIRED":
      // Worth being precise: reaching this code means TLS is working and the
      // certificate is simply not trusted. That is a much better position than
      // falling back to http://, so say so rather than letting someone
      // "fix" it by dropping encryption entirely.
      return "The deployment is serving TLS with a certificate this machine does not trust (often self-signed). Set IVEDAAI_ALLOW_INSECURE_TLS=true to keep the encryption while skipping certificate verification — weaker than proper TLS, but stronger than switching to http://.";
    case "EPROTO":
    case "ERR_SSL_WRONG_VERSION_NUMBER":
      return "That port is not speaking TLS. If IVEDAAI_BASE_URL starts with https:// and the deployment serves plain HTTP, use http:// instead.";
    default:
      // undici rejects a handful of ports outright and reports it only in the
      // message, with no code at all.
      if (/bad port/i.test(message)) {
        return "That port number is blocked by Node's HTTP client and cannot be used. Check the port in IVEDAAI_BASE_URL.";
      }
      return undefined;
  }
}

/**
 * A legible message for a transport-level fetch failure, or undefined when the
 * error is something else and the caller should rethrow it unchanged.
 *
 * `what` names the thing being attempted — an operation id, or the token
 * request — so the message says which call died without the caller
 * reformatting it.
 */
export function connectionFailureMessage(err: unknown, what: string, url: string): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const chain = causeChain(err);
  // A bare TypeError from fetch with nothing underneath is still ours to
  // explain — "fetch failed" alone is exactly the case this exists for.
  const isFetchFailure = chain.some((e) => e.message === "fetch failed") || err.name === "TypeError";
  if (!isFetchFailure) return undefined;

  const withCode = chain.find((e) => typeof (e as { code?: unknown }).code === "string");
  const code = (withCode as { code?: string } | undefined)?.code;
  // The innermost message is the specific one; "fetch failed" is the wrapper.
  const detail = chain.map((e) => e.message).filter((m) => m !== "fetch failed").pop();

  const origin = safeOrigin(url);
  const parts = [`Could not reach the IvedaAI server at ${origin} for ${what}.`];
  if (code || detail) {
    parts.push(`Cause: ${[code, detail].filter(Boolean).join(" — ")}.`);
  }
  const advice = adviceFor(code ?? "", detail ?? "");
  if (advice) parts.push(advice);
  parts.push("This is a connection problem rather than a rejected request, so retrying the same call will fail the same way.");
  return parts.join(" ");
}

/** Origin only — the path and query can carry parameters worth not echoing. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

//! TraceKit core: deterministic IDs, W3C trace context, baggage, and redaction.
//!
//! This crate is intentionally pure: no network, no async runtime, and no
//! per-request global state beyond the monotonic ULID clock.

use serde_json::Value;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_LEN: usize = 26;
const MAX_HEADER_BYTES: usize = 1024;
const MAX_STRING_BYTES: usize = 4096;

pub const BAGGAGE_MAX_BYTES: usize = 8192;
pub const BAGGAGE_MAX_MEMBERS: usize = 180;
pub const TRACESTATE_MAX_MEMBERS: usize = 32;
pub const TRACESTATE_MAX_BYTES: usize = 512;

const REDACTED: &str = "[REDACTED]";

/// Keys whose values are always redacted from structured payloads.
pub const DEFAULT_REDACT_KEYS: &[&str] = &[
    "authorization",
    "cookie",
    "set-cookie",
    "setcookie",
    "password",
    "passwd",
    "passkey",
    "secret",
    "token",
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "session_token",
    "sessionToken",
    "api_key",
    "apiKey",
    "apikey",
    "private_key",
    "privateKey",
    "otp",
    "mfa_code",
    "mfaCode",
    "totp",
    "credit_card",
    "creditCard",
    "card_number",
    "cardNumber",
    "cvv",
];

static ULID_STATE: Mutex<(u64, u128)> = Mutex::new((0, 0));
static UUIDV7_STATE: Mutex<(u64, u128)> = Mutex::new((0, 0));

// ---------------------------------------------------------------------------
// Randomness helpers
// ---------------------------------------------------------------------------

fn random_bytes(buf: &mut [u8]) -> bool {
    getrandom::getrandom(buf).is_ok()
}

fn fallback_u128() -> u128 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let addr = &nanos as *const u128 as u128;
    let mut x = nanos ^ (pid << 64) ^ addr;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    x ^= x >> 33;
    x
}

fn random_u128() -> u128 {
    let mut buf = [0u8; 16];
    if random_bytes(&mut buf) {
        u128::from_be_bytes(buf)
    } else {
        fallback_u128()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// ULID
// ---------------------------------------------------------------------------

fn encode_time(mut ms: u64, out: &mut String) {
    let mut buf = [0u8; 10];
    for i in (0..10).rev() {
        buf[i] = CROCKFORD[(ms & 0x1F) as usize];
        ms >>= 5;
    }
    out.push_str(std::str::from_utf8(&buf).unwrap_or_default());
}

fn encode_random(mut rand: u128, out: &mut String) {
    let mut buf = [0u8; 16];
    for i in (0..16).rev() {
        buf[i] = CROCKFORD[(rand & 0x1F) as usize];
        rand >>= 5;
    }
    out.push_str(std::str::from_utf8(&buf).unwrap_or_default());
}

/// Generate a monotonic ULID string.
pub fn new_ulid() -> String {
    const RANDOM_MASK: u128 = (1u128 << 80) - 1;
    let now = now_ms();
    let (timestamp, rand) = {
        let mut state = ULID_STATE.lock().unwrap_or_else(|e| e.into_inner());
        let (last_ms, last_rand) = *state;
        if now > last_ms {
            let rand = random_u128() & RANDOM_MASK;
            *state = (now, rand);
            (now, rand)
        } else {
            let rand = (last_rand.wrapping_add(1)) & RANDOM_MASK;
            *state = (last_ms, rand);
            (last_ms, rand)
        }
    };
    let mut out = String::with_capacity(ULID_LEN);
    encode_time(timestamp, &mut out);
    encode_random(rand, &mut out);
    out
}

pub fn new_request_id() -> String {
    format!("cp_{}", new_ulid())
}

pub fn new_action_id() -> String {
    format!("act_{}", new_ulid())
}

pub fn new_job_id() -> String {
    format!("job_{}", new_ulid())
}

pub fn new_workflow_id() -> String {
    format!("workflow_{}", new_ulid())
}

// ---------------------------------------------------------------------------
// UUIDv7
// ---------------------------------------------------------------------------

const UUIDV7_TAIL_MASK: u128 = (1u128 << 74) - 1;

/// Generate a monotonic UUIDv7 canonical string (`xxxxxxxx-xxxx-7xxx-yxxx-...`).
pub fn new_uuidv7() -> String {
    let now = now_ms();
    let (timestamp, tail) = {
        let mut state = UUIDV7_STATE.lock().unwrap_or_else(|e| e.into_inner());
        let (last_ms, last_tail) = *state;
        if now > last_ms {
            let tail = random_u128() & UUIDV7_TAIL_MASK;
            *state = (now, tail);
            (now, tail)
        } else {
            let tail = last_tail.wrapping_add(1) & UUIDV7_TAIL_MASK;
            *state = (last_ms, tail);
            (last_ms, tail)
        }
    };
    format_uuidv7(timestamp, tail)
}

fn format_uuidv7(timestamp: u64, tail: u128) -> String {
    let timestamp = timestamp & 0xffff_ffff_ffff;
    let rand_a = ((tail >> 62) & 0x0fff) as u16;
    let rand_b = tail & ((1u128 << 62) - 1);
    format!(
        "{:08x}-{:04x}-7{:03x}-{:04x}-{:012x}",
        (timestamp >> 16) & 0xffff_ffff,
        timestamp & 0xffff,
        rand_a,
        0x8000u16 | ((rand_b >> 48) as u16 & 0x3fff),
        rand_b & 0xffff_ffff_ffff,
    )
}

/// Validate a canonical UUIDv7 string. Uppercase input is accepted.
pub fn is_valid_uuidv7(value: &str) -> bool {
    parse_uuidv7(value).is_some()
}

fn parse_uuidv7(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.len() != 36 {
        return None;
    }
    let bytes = trimmed.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        match index {
            8 | 13 | 18 | 23 => {
                if *byte != b'-' {
                    return None;
                }
            }
            _ => {
                if !byte.is_ascii_hexdigit() {
                    return None;
                }
            }
        }
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.as_bytes()[14] != b'7' {
        return None;
    }
    if !matches!(lower.as_bytes()[19], b'8' | b'9' | b'a' | b'b') {
        return None;
    }
    Some(lower)
}

fn normalize_ulid_prefixed(value: &str, prefix: &str) -> Option<String> {
    if !is_valid_ulid(value) {
        return None;
    }
    Some(format!("{}{}", prefix, value.to_ascii_uppercase()))
}

fn crockford_index(ch: u8) -> Option<u8> {
    let upper = ch.to_ascii_uppercase();
    CROCKFORD.iter().position(|c| *c == upper).map(|i| i as u8)
}

/// Validate a bare ULID (26 Crockford chars, timestamp within 48 bits).
pub fn is_valid_ulid(value: &str) -> bool {
    if value.len() != ULID_LEN {
        return false;
    }
    let bytes = value.as_bytes();
    if !bytes.iter().all(|b| crockford_index(*b).is_some()) {
        return false;
    }
    // First character holds the top 3 bits of the 48-bit timestamp: max is '7'.
    let first = crockford_index(bytes[0]).unwrap_or(0xFF);
    first <= 7
}

/// Normalize `cp_<ULID>`, `cp_<UUIDv7>`, or a legacy `req_<ULID>`.
///
/// New IDs are canonical `cp_<ULID>`. `cp_<UUIDv7>` is preserved in lowercase.
/// Legacy `req_<ULID>` IDs are preserved so mixed deployments keep correlating.
pub fn normalize_request_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if let Some(rest) = trimmed.strip_prefix("cp_") {
        if let Some(uuid) = parse_uuidv7(rest) {
            return Some(format!("cp_{}", uuid));
        }
        return normalize_ulid_prefixed(rest, "cp_");
    }
    if let Some(rest) = trimmed.strip_prefix("req_") {
        return normalize_ulid_prefixed(rest, "req_");
    }
    if let Some(uuid) = parse_uuidv7(trimmed) {
        return Some(format!("cp_{}", uuid));
    }
    normalize_ulid_prefixed(trimmed, "cp_")
}

pub fn normalize_action_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let candidate = trimmed.strip_prefix("act_").unwrap_or(trimmed);
    if let Some(uuid) = parse_uuidv7(candidate) {
        return Some(format!("act_{}", uuid));
    }
    normalize_ulid_prefixed(candidate, "act_")
}

pub fn normalize_job_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let candidate = trimmed.strip_prefix("job_").unwrap_or(trimmed);
    if let Some(uuid) = parse_uuidv7(candidate) {
        return Some(format!("job_{}", uuid));
    }
    normalize_ulid_prefixed(candidate, "job_")
}

pub fn normalize_workflow_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let candidate = trimmed.strip_prefix("workflow_").unwrap_or(trimmed);
    if let Some(uuid) = parse_uuidv7(candidate) {
        return Some(format!("workflow_{}", uuid));
    }
    normalize_ulid_prefixed(candidate, "workflow_")
}

pub fn is_valid_request_id(value: &str) -> bool {
    normalize_request_id(value).is_some()
}

// ---------------------------------------------------------------------------
// Trace and span IDs
// ---------------------------------------------------------------------------

pub fn new_trace_id_hex() -> String {
    let value = random_u128();
    // A valid trace id must not be all zeros.
    let value = if value == 0 { 1 } else { value };
    format!("{:032x}", value)
}

pub fn new_span_id_hex() -> String {
    let mut buf = [0u8; 8];
    if !random_bytes(&mut buf) {
        let value = random_u128() as u64;
        buf = value.to_be_bytes();
    }
    let value = u64::from_be_bytes(buf);
    let value = if value == 0 { 1 } else { value };
    format!("{:016x}", value)
}

fn is_lower_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn is_zero_hex(value: &str) -> bool {
    value.bytes().all(|b| b == b'0')
}

// ---------------------------------------------------------------------------
// W3C Trace Context
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceParent {
    pub trace_id: String,
    pub span_id: String,
    pub flags: u8,
}

/// Parse a W3C `traceparent` header value.
///
/// Version `00` requires exactly 55 characters. Future versions may append
/// vendor data; we validate the common prefix and ignore the rest.
pub fn parse_traceparent(value: &str) -> Option<TraceParent> {
    let value = value.trim();
    if value.len() < 55 {
        return None;
    }
    let mut parts = value.split('-');
    let version = parts.next()?;
    let trace_id = parts.next()?;
    let span_id = parts.next()?;
    let flags = parts.next()?;

    if version.len() != 2 || version == "ff" {
        return None;
    }
    if !version
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    if version == "00" && value.len() != 55 {
        return None;
    }
    if !is_lower_hex(trace_id, 32) || is_zero_hex(trace_id) {
        return None;
    }
    if !is_lower_hex(span_id, 16) || is_zero_hex(span_id) {
        return None;
    }
    if flags.len() != 2
        || !flags
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return None;
    }
    let flags = u8::from_str_radix(flags, 16).ok()?;
    Some(TraceParent {
        trace_id: trace_id.to_string(),
        span_id: span_id.to_string(),
        flags,
    })
}

/// Format a W3C `traceparent` header value.
pub fn format_traceparent(trace_id: &str, span_id: &str, flags: u8) -> Option<String> {
    if !is_lower_hex(trace_id, 32) || is_zero_hex(trace_id) {
        return None;
    }
    if !is_lower_hex(span_id, 16) || is_zero_hex(span_id) {
        return None;
    }
    Some(format!("00-{}-{}-{:02x}", trace_id, span_id, flags))
}

/// Validate a W3C `tracestate` header value.
pub fn is_valid_tracestate(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() {
        return true;
    }
    if value.len() > TRACESTATE_MAX_BYTES {
        return false;
    }
    let members: Vec<&str> = value.split(',').map(|m| m.trim()).collect();
    if members.len() > TRACESTATE_MAX_MEMBERS {
        return false;
    }
    for member in members {
        let mut kv = member.splitn(2, '=');
        let key = kv.next().unwrap_or_default().trim();
        let val = kv.next().unwrap_or_default().trim();
        if key.is_empty() || key.len() > 256 || val.is_empty() || val.len() > 256 {
            return false;
        }
        if key.contains(char::is_whitespace) || val.contains(char::is_whitespace) {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Header sanitization
// ---------------------------------------------------------------------------

/// Strip control characters, collapse surrounding whitespace, and cap length.
pub fn sanitize_header_value(value: &str) -> Option<String> {
    let cleaned: String = value
        .chars()
        .filter(|ch| {
            let code = *ch as u32;
            code >= 0x20 && code != 0x7f
        })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return None;
    }
    if cleaned.len() > MAX_HEADER_BYTES {
        return None;
    }
    Some(cleaned.to_string())
}

// ---------------------------------------------------------------------------
// Baggage
// ---------------------------------------------------------------------------

fn is_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
        || matches!(
            ch,
            '!' | '#'
                | '$'
                | '%'
                | '&'
                | '\''
                | '*'
                | '+'
                | '-'
                | '.'
                | '^'
                | '_'
                | '`'
                | '|'
                | '~'
        )
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// Parse a W3C `baggage` header value, enforcing OTel limits.
pub fn parse_baggage(value: &str) -> Vec<(String, String)> {
    let value = value.trim();
    if value.is_empty() || value.len() > BAGGAGE_MAX_BYTES {
        return Vec::new();
    }
    let mut items = Vec::new();
    for member in value.split(',') {
        if items.len() >= BAGGAGE_MAX_MEMBERS {
            break;
        }
        let member = member.split(';').next().unwrap_or_default().trim();
        if member.is_empty() {
            continue;
        }
        let mut kv = member.splitn(2, '=');
        let raw_key = kv.next().unwrap_or_default().trim();
        let raw_value = kv.next().unwrap_or_default().trim();
        if raw_key.is_empty() || !raw_key.chars().all(is_token_char) {
            continue;
        }
        items.push((raw_key.to_string(), percent_decode(raw_value)));
    }
    items
}

/// Format a W3C `baggage` header value. Returns `None` when limits are exceeded.
pub fn format_baggage(items: &[(String, String)]) -> Option<String> {
    if items.len() > BAGGAGE_MAX_MEMBERS {
        return None;
    }
    let mut encoded = Vec::with_capacity(items.len());
    let mut total = 0usize;
    for (key, value) in items {
        if key.is_empty() || !key.chars().all(is_token_char) {
            return None;
        }
        let member = format!("{}={}", key, percent_encode(value));
        total += member.len() + if encoded.is_empty() { 0 } else { 1 };
        if total > BAGGAGE_MAX_BYTES {
            return None;
        }
        encoded.push(member);
    }
    Some(encoded.join(","))
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/// Deterministic, trace-id-based sampling decision.
pub fn should_sample(trace_id_hex: &str, ratio: f64) -> bool {
    if ratio >= 1.0 {
        return true;
    }
    if ratio <= 0.0 {
        return false;
    }
    let prefix = if trace_id_hex.len() >= 8 {
        &trace_id_hex[..8]
    } else {
        return false;
    };
    let Ok(bucket) = u32::from_str_radix(prefix, 16) else {
        return false;
    };
    let threshold = (ratio * (u32::MAX as f64)) as u32;
    bucket <= threshold
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

fn is_sensitive_key(key: &str, extra: &[String]) -> bool {
    let lower = key.to_ascii_lowercase();
    if DEFAULT_REDACT_KEYS
        .iter()
        .any(|candidate| lower == candidate.to_ascii_lowercase())
    {
        return true;
    }
    extra
        .iter()
        .any(|candidate| lower == candidate.to_ascii_lowercase())
}

fn redact_value(value: &Value, extra: &[String]) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::with_capacity(map.len());
            for (key, child) in map {
                if is_sensitive_key(key, extra) {
                    out.insert(key.clone(), Value::String(REDACTED.to_string()));
                } else {
                    out.insert(key.clone(), redact_value(child, extra));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| redact_value(item, extra)).collect())
        }
        Value::String(text) if text.len() > MAX_STRING_BYTES => {
            let mut truncated = text.chars().take(MAX_STRING_BYTES).collect::<String>();
            truncated.push_str("...[truncated]");
            Value::String(truncated)
        }
        other => other.clone(),
    }
}

/// Redact sensitive keys and truncate oversized strings in a JSON value.
pub fn redact_json(value: &Value, extra_keys: &[String]) -> Value {
    redact_value(value, extra_keys)
}

/// Parse, redact, and re-serialize a JSON string.
pub fn redact_json_str(value: &str, extra_keys: &[String]) -> Option<String> {
    let parsed: Value = serde_json::from_str(value).ok()?;
    serde_json::to_string(&redact_value(&parsed, extra_keys)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ulids_are_unique_and_valid() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..10_000 {
            let id = new_ulid();
            assert!(is_valid_ulid(&id), "invalid ulid: {id}");
            assert!(seen.insert(id), "duplicate ulid generated");
        }
    }

    #[test]
    fn monotonic_ulids_sort_in_order() {
        let first = new_ulid();
        let second = new_ulid();
        assert!(first < second, "{first} should sort before {second}");
    }

    #[test]
    fn request_ids_round_trip() {
        let id = new_request_id();
        assert!(id.starts_with("cp_"), "new request ids use the cp_ prefix");
        let body = id.strip_prefix("cp_").unwrap();
        assert!(is_valid_ulid(body), "request id contains a valid ulid");
        assert_eq!(normalize_request_id(&id).as_deref(), Some(id.as_str()));
        assert!(is_valid_request_id(&id));
        assert!(!is_valid_request_id("req_not-a-ulid"));
        assert!(normalize_request_id("not-an-id").is_none());
    }

    #[test]
    fn uuidv7_request_ids_are_supported() {
        let id = format!("cp_{}", new_uuidv7());
        assert_eq!(normalize_request_id(&id).as_deref(), Some(id.as_str()));
        assert!(is_valid_request_id(&id));

        let bare = new_uuidv7();
        let normalized = normalize_request_id(&bare).unwrap();
        assert_eq!(normalized, format!("cp_{}", bare));
    }

    #[test]
    fn legacy_ulid_request_ids_are_preserved() {
        let legacy = format!("req_{}", new_ulid());
        assert_eq!(
            normalize_request_id(&legacy).as_deref(),
            Some(legacy.as_str())
        );
        assert!(is_valid_request_id(&legacy));

        let bare = new_ulid();
        let normalized = normalize_request_id(&bare).unwrap();
        assert_eq!(normalized, format!("cp_{}", bare));
    }

    #[test]
    fn workflow_job_and_action_ids_use_ulid_bodies() {
        let action = new_action_id();
        assert!(action.starts_with("act_"));
        assert!(is_valid_ulid(&action["act_".len()..]));

        let job = new_job_id();
        assert!(job.starts_with("job_"));
        assert!(is_valid_ulid(&job["job_".len()..]));

        let workflow = new_workflow_id();
        assert!(workflow.starts_with("workflow_"));
        assert!(is_valid_ulid(&workflow["workflow_".len()..]));
        assert_eq!(
            normalize_workflow_id(&workflow).as_deref(),
            Some(workflow.as_str())
        );

        let uuid_workflow = format!("workflow_{}", new_uuidv7());
        assert_eq!(
            normalize_workflow_id(&uuid_workflow).as_deref(),
            Some(uuid_workflow.as_str())
        );
    }

    #[test]
    fn uuidv7_format_and_monotonicity() {
        let first = new_uuidv7();
        let second = new_uuidv7();
        assert_eq!(first.len(), 36);
        assert!(is_valid_uuidv7(&first));
        assert!(is_valid_uuidv7(&first.to_ascii_uppercase()));
        assert!(first < second, "{first} should sort before {second}");

        let bytes = first.as_bytes();
        assert_eq!(bytes[8], b'-');
        assert_eq!(bytes[13], b'-');
        assert_eq!(bytes[18], b'-');
        assert_eq!(bytes[23], b'-');
        assert_eq!(bytes[14], b'7');
        assert!(matches!(bytes[19], b'8' | b'9' | b'a' | b'b'));

        assert!(!is_valid_uuidv7("00000000-0000-6000-8000-000000000000"));
        assert!(!is_valid_uuidv7("00000000-0000-7000-0000-000000000000"));
        assert!(!is_valid_uuidv7("not-a-uuid"));
    }

    #[test]
    fn traceparent_round_trip() {
        let trace_id = new_trace_id_hex();
        let span_id = new_span_id_hex();
        let header = format_traceparent(&trace_id, &span_id, 1).unwrap();
        let parsed = parse_traceparent(&header).unwrap();
        assert_eq!(parsed.trace_id, trace_id);
        assert_eq!(parsed.span_id, span_id);
        assert_eq!(parsed.flags, 1);
    }

    #[test]
    fn traceparent_rejects_bad_values() {
        assert!(parse_traceparent("").is_none());
        assert!(
            parse_traceparent("00-00000000000000000000000000000000-0000000000000000-01").is_none()
        );
        assert!(
            parse_traceparent("ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01").is_none()
        );
        assert!(
            parse_traceparent("00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01").is_none()
        );
        assert!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra")
                .is_none()
        );
    }

    #[test]
    fn baggage_round_trips_and_enforces_limits() {
        let items = vec![
            ("tenant".to_string(), "ten_123".to_string()),
            ("note".to_string(), "hello world".to_string()),
        ];
        let encoded = format_baggage(&items).unwrap();
        let decoded = parse_baggage(&encoded);
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[1].1, "hello world");

        let too_many: Vec<(String, String)> = (0..181)
            .map(|i| (format!("k{i}"), "v".to_string()))
            .collect();
        assert!(format_baggage(&too_many).is_none());
    }

    #[test]
    fn sanitize_strips_control_characters() {
        assert_eq!(sanitize_header_value("  a\r\nb  ").as_deref(), Some("ab"));
        assert!(sanitize_header_value("\r\n").is_none());
    }

    #[test]
    fn redaction_covers_default_and_custom_keys() {
        let input = r#"{"authorization":"Bearer abc","password":"x","user":{"email":"a@b.c","apiKey":"k"},"note":"ok"}"#;
        let output = redact_json_str(input, &["email".to_string()]).unwrap();
        let parsed: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(parsed["authorization"], REDACTED);
        assert_eq!(parsed["password"], REDACTED);
        assert_eq!(parsed["user"]["apiKey"], REDACTED);
        assert_eq!(parsed["user"]["email"], REDACTED);
        assert_eq!(parsed["note"], "ok");
    }

    #[test]
    fn sampling_is_deterministic() {
        let trace_id = new_trace_id_hex();
        assert!(should_sample(&trace_id, 1.0));
        assert!(!should_sample(&trace_id, 0.0));
        assert_eq!(should_sample(&trace_id, 0.5), should_sample(&trace_id, 0.5));
    }
}

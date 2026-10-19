use napi_derive::napi;

#[napi(object)]
pub struct TraceParentJs {
    pub trace_id: String,
    pub span_id: String,
    pub flags: u32,
}

#[napi(object)]
pub struct BaggageItemJs {
    pub key: String,
    pub value: String,
}

#[napi]
pub fn new_ulid() -> String {
    tracekit_core::new_ulid()
}

#[napi]
pub fn new_uuidv7() -> String {
    tracekit_core::new_uuidv7()
}

#[napi]
pub fn is_valid_uuidv7(value: String) -> bool {
    tracekit_core::is_valid_uuidv7(&value)
}

#[napi]
pub fn new_request_id() -> String {
    tracekit_core::new_request_id()
}

#[napi]
pub fn new_action_id() -> String {
    tracekit_core::new_action_id()
}

#[napi]
pub fn new_job_id() -> String {
    tracekit_core::new_job_id()
}

#[napi]
pub fn new_workflow_id() -> String {
    tracekit_core::new_workflow_id()
}

#[napi]
pub fn new_trace_id() -> String {
    tracekit_core::new_trace_id_hex()
}

#[napi]
pub fn new_span_id() -> String {
    tracekit_core::new_span_id_hex()
}

#[napi]
pub fn is_valid_ulid(value: String) -> bool {
    tracekit_core::is_valid_ulid(&value)
}

#[napi]
pub fn is_valid_request_id(value: String) -> bool {
    tracekit_core::is_valid_request_id(&value)
}

#[napi]
pub fn normalize_request_id(value: String) -> Option<String> {
    tracekit_core::normalize_request_id(&value)
}

#[napi]
pub fn normalize_action_id(value: String) -> Option<String> {
    tracekit_core::normalize_action_id(&value)
}

#[napi]
pub fn normalize_job_id(value: String) -> Option<String> {
    tracekit_core::normalize_job_id(&value)
}

#[napi]
pub fn normalize_workflow_id(value: String) -> Option<String> {
    tracekit_core::normalize_workflow_id(&value)
}

#[napi]
pub fn parse_traceparent(value: String) -> Option<TraceParentJs> {
    tracekit_core::parse_traceparent(&value).map(|parsed| TraceParentJs {
        trace_id: parsed.trace_id,
        span_id: parsed.span_id,
        flags: parsed.flags as u32,
    })
}

#[napi]
pub fn format_traceparent(trace_id: String, span_id: String, flags: u32) -> Option<String> {
    tracekit_core::format_traceparent(&trace_id, &span_id, flags as u8)
}

#[napi]
pub fn is_valid_tracestate(value: String) -> bool {
    tracekit_core::is_valid_tracestate(&value)
}

#[napi]
pub fn sanitize_header_value(value: String) -> Option<String> {
    tracekit_core::sanitize_header_value(&value)
}

#[napi]
pub fn parse_baggage(value: String) -> Vec<BaggageItemJs> {
    tracekit_core::parse_baggage(&value)
        .into_iter()
        .map(|(key, value)| BaggageItemJs { key, value })
        .collect()
}

#[napi]
pub fn format_baggage(items: Vec<BaggageItemJs>) -> Option<String> {
    let pairs: Vec<(String, String)> = items
        .into_iter()
        .map(|item| (item.key, item.value))
        .collect();
    tracekit_core::format_baggage(&pairs)
}

#[napi]
pub fn should_sample(trace_id: String, ratio: f64) -> bool {
    tracekit_core::should_sample(&trace_id, ratio)
}

#[napi]
pub fn redact_json(json: String, extra_keys: Option<Vec<String>>) -> Option<String> {
    tracekit_core::redact_json_str(&json, &extra_keys.unwrap_or_default())
}

use std::io::{self, Write};

const EVIDENCE_PREFIX: &str = "VIBEROOTS_TAURI_COMPOSITION_EVIDENCE ";
const FAILURE_PREFIX: &str = "VIBEROOTS_TAURI_COMPOSITION_FAILURE ";

fn json_string(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect(),
            '\n' => "\\n".chars().collect(),
            '\r' => "\\r".chars().collect(),
            '\t' => "\\t".chars().collect(),
            value if value.is_control() => "?".chars().collect(),
            value => vec![value],
        })
        .collect()
}

#[tauri::command]
fn report_composition_evidence(
    rust_value: i32,
    cpp_value: i32,
    go_value: i32,
) -> Result<(), String> {
    if [rust_value, cpp_value, go_value] != [42, 42, 42] {
        return Err(format!(
            "unexpected WASM evidence: rust={rust_value} cpp={cpp_value} go={go_value}"
        ));
    }
    let backend = composition_backend::answer();
    let bridge = composition_bridge::bridged_answer();
    if [backend, bridge] != [42, 42] {
        return Err(format!(
            "unexpected native evidence: backend={backend} bridge={bridge}"
        ));
    }
    let mut stdout = io::stdout().lock();
    writeln!(
        stdout,
        "{EVIDENCE_PREFIX}{{\"backend\":{backend},\"bridge\":{bridge},\"rustWasm\":{rust_value},\"cppWasm\":{cpp_value},\"goWasm\":{go_value},\"complete\":true}}"
    )
    .and_then(|_| stdout.flush())
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn report_composition_failure(message: String) -> Result<(), String> {
    let mut stdout = io::stdout().lock();
    writeln!(
        stdout,
        "{FAILURE_PREFIX}{{\"stage\":\"frontend\",\"message\":\"{}\",\"complete\":false}}",
        json_string(&message)
    )
    .and_then(|_| stdout.flush())
    .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|_| {
            let backend = composition_backend::answer();
            let bridge = composition_bridge::bridged_answer();
            assert_eq!(backend, 42);
            assert_eq!(bridge, 42);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_composition_evidence,
            report_composition_failure
        ])
        .run(tauri::generate_context!())
        .expect("error while running typed composition application");
}

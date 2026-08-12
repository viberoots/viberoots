pub fn snapshot_message() -> &'static str {
    "rust-remote-snapshot-v1"
}

#[test]
fn executes_declared_snapshot_source() {
    assert_eq!(snapshot_message(), "rust-remote-snapshot-v1");
}

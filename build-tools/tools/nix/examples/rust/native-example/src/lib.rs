pub fn message() -> &'static str {
    "viberoots-rust-native-example"
}

#[cfg(test)]
mod tests {
    #[test]
    fn message_is_stable() {
        assert_eq!(super::message(), "viberoots-rust-native-example");
    }
}

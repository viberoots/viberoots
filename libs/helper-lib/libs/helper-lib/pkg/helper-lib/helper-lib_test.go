package helperlib

import "testing"

func TestHello(t *testing.T) {
	if Hello() == "" {
		t.Fatal("expected non-empty greeting")
	}
}

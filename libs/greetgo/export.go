package greetgo

// #include <stdint.h>
import "C"

//export GoGreet
func GoGreet() *C.char {
    return C.CString("hello from go")
}



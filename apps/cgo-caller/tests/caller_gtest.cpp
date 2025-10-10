#include <gtest/gtest.h>

extern "C" char* GoGreet();

TEST(CGoCaller, CallsGo) {
    char* s = GoGreet();
    ASSERT_NE(s, nullptr);
}



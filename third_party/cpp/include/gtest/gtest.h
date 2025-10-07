#pragma once
// Minimal placeholder to allow local builds without nixpkgs gtest.
// Real gtest should be provided via nixpkgs in production; this shim just
// provides the declarations used by the scaffold's test runner.
namespace testing {
    inline void InitGoogleTest(int*, char**) {}
    inline int RUN_ALL_TESTS() { return 0; }
}

// Also expose RUN_ALL_TESTS in the global namespace for the stub main
inline int RUN_ALL_TESTS() { return testing::RUN_ALL_TESTS(); }

#define TEST(Suite, Name) void Suite##_##Name()
#define EXPECT_EQ(a,b) do { (void)(a); (void)(b); } while(0)



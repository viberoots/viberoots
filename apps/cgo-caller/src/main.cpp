#include <iostream>

extern "C" char* GoGreet();

int main() {
    char* s = GoGreet();
    if (s) {
        std::cout << s << "\n";
    } else {
        std::cout << "(nil)" << "\n";
    }
    return 0;
}



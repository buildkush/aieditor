#include <cstddef>
#include <iostream>
extern "C" size_t aiditor_tara_generation_budget_v1(size_t, size_t);
extern "C" size_t aiditor_tara_prompt_length_v1();
int main() {
  const auto prompt = aiditor_tara_prompt_length_v1();
  const auto budget = aiditor_tara_generation_budget_v1(448,4);
  if (prompt != 5 || budget != 444) { std::cerr << "Tara prompt/context patch is missing\n"; return 1; }
  std::cout << "Compiled Tara prompt=5; generation budget=444. No model or Python needed.\n";
}

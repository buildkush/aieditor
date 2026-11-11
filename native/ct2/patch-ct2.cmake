# Preserve the two Tara fixes from the previous measured CT2 build, plus cancellation.
function(aiditor_replace file before after)
  file(READ "${file}" text)
  string(FIND "${text}" "${after}" done)
  string(FIND "${text}" "${before}" found)
  # A shorter replacement may already be a substring of the unpatched code.
  # A growing replacement may itself contain the old anchor. Handle both cases.
  string(FIND "${after}" "${before}" growing)
  if(NOT done EQUAL -1 AND NOT growing EQUAL -1)
    return()
  endif()
  if(NOT found EQUAL -1)
    string(REPLACE "${before}" "${after}" text "${text}")
    file(WRITE "${file}" "${text}")
  elseif(done EQUAL -1)
    message(FATAL_ERROR "Pinned CT2 patch anchor missing: ${file}")
  endif()
endfunction()
set(whisper "${ctranslate2_SOURCE_DIR}/src/models/whisper.cc")
aiditor_replace("${whisper}"
  "prompt[index] >= sot_id && prompt[index] <= no_timestamps_id"
  "((prompt[index] >= sot_id && prompt[index] <= no_timestamps_id) || prompt[index] == 51866)")
aiditor_replace("${whisper}"
  "std::min(total_max_length / 2, total_max_length - start_step)"
  "aiditor_tara_generation_budget_v1(total_max_length, start_step)")
aiditor_replace("${whisper}" "    class ApplyTimestampRules;"
  "    extern \"C\" size_t aiditor_tara_generation_budget_v1(size_t total, size_t start) { return total - start; }\n    extern \"C\" size_t aiditor_tara_prompt_length_v1() { return get_prompt_length({50258, 50276, 51866, 50360, 50364}, 50258, 50364); }\n    class ApplyTimestampRules;")
aiditor_replace("${ctranslate2_SOURCE_DIR}/include/ctranslate2/models/whisper.h"
  "struct WhisperOptions {" "struct WhisperOptions {\n      std::function<bool()> aiditor_abort;")
aiditor_replace("${whisper}" "decoding_options.include_eos_in_hypotheses = false;"
  "decoding_options.include_eos_in_hypotheses = false;\n      if (options.aiditor_abort) decoding_options.callback = [abort = options.aiditor_abort](DecodingStepResult) { if (abort()) throw std::runtime_error(\"Cancelled\"); return false; };")
if(WIN32 AND WITH_MKL)
  # Intel's redistributable import libraries use the _dll suffix.
  set(cmake "${ctranslate2_SOURCE_DIR}/CMakeLists.txt")
  file(READ "${cmake}" text)
  foreach(name mkl_core mkl_intel_ilp64 mkl_intel_thread mkl_sequential)
    string(REPLACE "${name}.lib" "${name}_dll.lib" text "${text}")
  endforeach()
  string(REPLACE "NAMES mkl_core HINTS" "NAMES mkl_core_dll HINTS" text "${text}")
  file(WRITE "${cmake}" "${text}")
endif()

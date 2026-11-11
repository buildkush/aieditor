// Narrow C ABI: no Python wrapper, shared C++/Rust layouts, or exceptions across FFI.
#include <ctranslate2/models/whisper.h>
#include <ctranslate2/types.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <cstring>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <unordered_map>

#ifdef _WIN32
#define API extern "C" __declspec(dllexport)
#else
#define API extern "C" __attribute__((visibility("default")))
#endif
using json = nlohmann::json;
using Clock = std::chrono::steady_clock;
static double seconds(Clock::time_point start) {
  return std::chrono::duration<double>(Clock::now() - start).count();
}
static char* payload(const json& value) {
  const auto text = value.dump();
  auto* result = new char[text.size() + 1];
  std::memcpy(result, text.c_str(), text.size() + 1);
  return result;
}
using Pool = ctranslate2::models::Whisper;
struct EnginePool : Pool {
  using Pool::Pool;
  std::unordered_map<std::string,size_t> language_ids;
};
extern "C" size_t aiditor_tara_generation_budget_v1(size_t total, size_t start);
extern "C" size_t aiditor_tara_prompt_length_v1();
API const char* aiditor_ct2_abi_v1() { return "aiditor-ct2-4.8.4-tara-v1"; }
API void aiditor_ct2_free_v1(char* text) { delete[] text; }
API void aiditor_ct2_close_v1(void* handle) { delete static_cast<EnginePool*>(handle); }
API void* aiditor_ct2_open_v1(const char* path, size_t threads, size_t workers, char** error) {
  try {
    if (!path || !error || threads < 1 || workers < 1 || threads > 256 || workers > 64)
      throw std::invalid_argument("Invalid CT2 model or scheduler arguments");
    *error = nullptr;
    if (aiditor_tara_generation_budget_v1(448,4) != 444 || aiditor_tara_prompt_length_v1() != 5)
      throw std::runtime_error("Compiled Tara prompt/context patch is missing");
    json vocab;
    std::ifstream input(std::string(path) + "/vocabulary.json"); input >> vocab;
    if (vocab.size() != 51904 || vocab[51866] != "<|mixedcode|>"
        || vocab[50258] != "<|startoftranscript|>" || vocab[50364] != "<|notimestamps|>")
      throw std::runtime_error("Tara vocabulary/token IDs do not match");
    ctranslate2::models::ModelLoader loader(path);
    loader.device = ctranslate2::Device::CPU;
    loader.compute_type = ctranslate2::ComputeType::INT8_FLOAT32;
    loader.num_replicas_per_device = workers;
    ctranslate2::ReplicaPoolConfig config;
    config.num_threads_per_replica = threads;
    config.max_queued_batches = static_cast<long>(workers);
    auto model = std::make_unique<EnginePool>(loader, config);
    for (size_t id = 50259; id < 50359; ++id) model->language_ids.emplace(vocab[id].get<std::string>(),id);
    if (model->n_mels() != 128) throw std::runtime_error("Tara must have 128 mel bins");
    const auto actual_type = model->post<ctranslate2::ComputeType>([](ctranslate2::models::WhisperReplica& replica) {
      return replica.model()->effective_compute_type();
    }).get();
    if (actual_type != ctranslate2::ComputeType::INT8_FLOAT32)
      throw std::runtime_error("This CPU backend did not initialize INT8/FP32 computation");
    return model.release();
  } catch (const std::exception& e) {
    if (error) *error = payload({{"error", e.what()}});
    return nullptr;
  } catch (...) {
    if (error) *error = payload({{"error", "Unknown native CT2 initialization failure"}});
    return nullptr;
  }
}
API char* aiditor_ct2_chunk_v1(void* handle, const float* features, size_t count,
                            size_t audio_frames, int language_id, bool aligned,
                            bool (*abort)(void*), void* user) {
  try {
    if (!handle || !features || count != 128 * 3000 || audio_frames < 1 || audio_frames > 3000)
      throw std::invalid_argument("CT2 expects 128 x 3000 mel features");
    std::vector<float> copy(features, features + count);
    auto* pool = static_cast<EnginePool*>(handle);
    auto result = pool->post<json>(
      [data = std::move(copy), languages = pool->language_ids, audio_frames, language_id, aligned, abort, user]
      (ctranslate2::models::WhisperReplica& replica) mutable {
        const auto cancelled = [abort, user]() { return abort && abort(user); };
        if (cancelled()) throw std::runtime_error("Cancelled");
        auto start = Clock::now();
        ctranslate2::StorageView input({1, 128, 3000}, data);
        auto encoded = replica.encode(std::move(input), false);
        const double encoder = seconds(start);
        if (cancelled()) throw std::runtime_error("Cancelled");
        size_t lang = language_id > 0 ? static_cast<size_t>(language_id) : 50276;
        if (language_id == 0) {
          const auto detected = replica.detect_language(encoded);
          if (!detected.empty() && !detected[0].empty()) {
            const auto token = detected[0][0].first;
            const auto match = languages.find(token);
            if (match == languages.end()) throw std::runtime_error("Detected language is absent from Tara vocabulary");
            lang = match->second;
          }
        }
        const std::vector<size_t> prefix = {50258, lang, 51866, 50360, 50364};
        ctranslate2::models::WhisperOptions options;
        options.beam_size = 1; options.max_length = 448;
        options.suppress_tokens = {-1};
        for (int token = 50365; token < 51904; ++token) options.suppress_tokens.push_back(token);
        options.aiditor_abort = cancelled;
        start = Clock::now();
        auto generated = replica.generate(encoded, {prefix}, options);
        const double generation = seconds(start);
        if (cancelled()) throw std::runtime_error("Cancelled");
        std::vector<size_t> tokens;
        for (auto token : generated.at(0).sequences_ids.at(0)) if (token < 50257) tokens.push_back(token);
        json pairs = json::array(), probabilities = json::array();
        double alignment = 0;
        if (aligned && !tokens.empty()) {
          if (tokens.size() + prefix.size() + 1 > 448)
            throw std::runtime_error("Tara alignment exceeds context; no text was truncated");
          auto align_prefix = prefix; align_prefix.pop_back();
          start = Clock::now();
          const auto result = replica.align(encoded, align_prefix, {tokens},
            {audio_frames}, 7).at(0);
          alignment = seconds(start);
          for (auto pair : result.alignments) pairs.push_back({pair.first, pair.second});
          for (auto p : result.text_token_probs) probabilities.push_back(p);
        }
        if (cancelled()) throw std::runtime_error("Cancelled");
        return json{{"tokens",tokens},{"alignments",pairs},{"probabilities",probabilities},
          {"languageId",lang},{"encoderSec",encoder},{"generationDecoderSec",generation},
          {"alignmentSec",alignment},{"tokenLimitHit",tokens.size() >= 443},
          {"engine","ctranslate2"},{"version","4.8.4"},{"cpuBackend",AIDITOR_CT2_BACKEND}};
      });
    return payload(result.get());
  } catch (const std::exception& e) { return payload({{"error",e.what()}}); }
    catch (...) { return payload({{"error","Unknown native CT2 inference failure"}}); }
}

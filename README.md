<div align="center">

# ⚡ lmbench

### Benchmark the models running on *your* machine.

[![Live App](https://img.shields.io/badge/%F0%9F%94%B4_Live_App-lmbench-6C5CE7?style=for-the-badge)](https://saadsulek.github.io/lmbench/) [![Local Only](https://img.shields.io/badge/100%25-Local--Only-00B894?style=for-the-badge)](#-privacy) [![No Uploads](https://img.shields.io/badge/No-Uploads-FF6B6B?style=for-the-badge)](#-privacy)

</div>

lmbench is a live benchmark harness for local LLMs running in [LM Studio](https://lmstudio.ai/). It talks directly to LM Studio's local server, runs a fixed set of workloads against whatever models you have loaded, and ranks them by measured throughput, latency, and quality — entirely on the machine in front of you.

<div align="center">

**🔗 Try it live → [saadsulek.github.io/lmbench](https://saadsulek.github.io/lmbench/)**

</div>

---

## 💡 Why lmbench

Most LLM benchmarks assume a cloud endpoint, a hosted leaderboard, or numbers reported by someone else's hardware. lmbench does neither:

- 🖥️ **It measures your hardware, not a vendor's claim.** Every run hits the LM Studio server on `localhost`, so the numbers reflect the models, quantization, and machine you actually have.
- 🎯 **Conditions are pinned, not cherry-picked.** Temperature, top-p, and prompts are fixed per workload so differences in the results come from the model, not the settings.
- 🔐 **Nothing leaves localhost.** There's no relay, no account, and no telemetry — the page only ever talks to `http://localhost:1234`.

## ✨ Features

|     |                                                                              |
| --- | ---------------------------------------------------------------------------- |
| 🔌  | Connects straight to LM Studio's OpenAI-compatible local server              |
| 🧠  | Auto-discovers loaded models via `GET /v1/models`                            |
| 🧩  | Three workload classes — code, reasoning, and prose                          |
| 📊  | Four metrics per run — tokens, time, tok/s, and a quality badge              |
| 🔁  | Configurable repeats per cell, averaged before ranking                       |
| 🎚️  | Adjustable max-token ceiling, from 256 up to 1,000,000                       |
| 📈  | Live rolling throughput display while a run streams                          |
| 🗂️  | Run archive kept in the browser's local storage — no server, no spreadsheet  |

## ⚙️ How it works

| Stage                 | Process                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 🔗 **Connection**      | The page calls LM Studio's local HTTP server directly. No relay, no tunnel, no account — just the standard OpenAI-compatible API. |
| 🎛️ **Sampling**        | Temperature `0.2` and top-p `0.9` are pinned per workload, with no system prompt unless the workload calls for one.               |
| ⏱️ **Token accounting** | Throughput is the completion-token count divided by decode time alone; time-to-first-token is measured and reported separately.   |
| 🧪 **Workloads**       | Code generation, constrained reasoning, and long-form prose — each stresses a different bottleneck (decode speed, planning depth, context discipline). |
| 🏆 **Ranking**         | Models are sorted by mean tokens per second, with a quality badge shown alongside so a fast-but-wrong model is easy to spot.        |
| 💾 **History**         | Finished runs are written to the browser's local storage, so you can reload, swap a quant, and compare against the last run.       |

> ⚠️ **Note:** the harness never pads prompts to inflate context — the longest workload stays well under 2k tokens on purpose, so decode speed stays the story, not context handling.

## 📐 Methodology, in short

- **Throughput** = completion tokens ÷ wall-clock decode time, timed from request to full response; multi-repeat cells are averaged before ranking.
- **Run-to-run variance** is expected — thermal throttling, memory-bandwidth contention, and background load all shift local decode speed, so compare averages over several repeats rather than a single run.
- **Quality** is a coarse rubric check per workload (code fences present, numeric answer extracted, word-count band, valid JSON) — a gate, not a judge.
- **Context length** is reported per model when the server exposes it, but the harness deliberately keeps prompts short so it isn't the bottleneck being measured.

Full detail is on the [live methodology panel](https://saadsulek.github.io/lmbench/#method).

## 🚀 Usage

1. 🟢 Start LM Studio's local server (**Settings → Server → Start Server**).
2. 🌐 Open [the live app](https://saadsulek.github.io/lmbench/) (or run it locally — see below).
3. 🧠 Select the loaded models you want to benchmark.
4. 🧩 Choose workloads, repeats per cell, and a max-token ceiling.
5. ▶️ Run the benchmark and watch live throughput as it streams.
6. 🏆 Compare ranked results — finished runs are saved to the on-machine archive automatically.

> ⌨️ **Shortcuts:** `R` runs again, `Esc` stops a run in progress.

## 🖥️ Running locally

lmbench is a static site — no build step, no backend.

```
git clone https://github.com/saadsulek/lmbench.git
cd lmbench
# serve the folder with any static server, e.g.:
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser, with LM Studio's server running on `localhost:1234`.

## 🧰 Tech stack

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)]() [![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)]() [![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)]()

- 🧱 Client-side HTML/CSS/JavaScript, served as a static site
- 🔌 [LM Studio](https://lmstudio.ai/)'s OpenAI-compatible local server as the inference backend
- 🗂️ Browser `localStorage` for the on-machine run archive

## 🔒 Privacy

Every request goes to `localhost:1234` and nowhere else. There's no upload step, no account, and no telemetry — you can confirm this by watching the network tab, or by checking that the app keeps working with the rest of your network disconnected.

## 🤝 Contributing

Issues and pull requests are welcome! If you'd like to add a workload class or a new quality rubric, open an issue first so the scoring stays comparable across runs.

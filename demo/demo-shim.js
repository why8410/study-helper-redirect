// Study Helper for SA — 정적 데모 심(shim)
// 서버 없이 GitHub Pages에서 데모 모드를 제공한다.
// app.js 의 fetch("/api/...") 호출을 가로채 서버의 데모 응답을 재현한다.
(function () {
  const realFetch = window.fetch.bind(window);

  function jsonResponse(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  function extractProblemNumber(text) {
    const patterns = [/(\d+)\s*번/, /number\s*(\d+)/i, /no\.\s*(\d+)/i, /question\s*(\d+)/i];
    for (const p of patterns) {
      const m = String(text || "").match(p);
      if (m) return m[1];
    }
    return "";
  }

  function extractVisibleNumbers(text) {
    const found = [];
    const patterns = [/^\s*(\d{1,2})\s*[.)](?!\d)/gm, /^\s*(\d{1,2})\s*번/gm];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(String(text || ""))) !== null) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 50 && !found.includes(m[1])) found.push(m[1]);
      }
    }
    return found;
  }

  function demoCoach(payload) {
    const requestText = (payload.requestText || "").trim();
    const typedText = (payload.typedProblemText || "").trim();
    const manual = String(payload.manualProblemNumber || "").trim();
    const selected = manual || extractProblemNumber(requestText) || "1";
    let recognized = extractVisibleNumbers(typedText);
    if (!recognized.length) recognized = ["1", "2", "3"];
    if (!recognized.includes(selected)) recognized.push(selected);

    const lower = (typedText + " " + requestText).toLowerCase();
    let summary = "문장 뜻을 보고 알맞은 단어를 찾는 문제";
    let translation = selected + "번 문제는 영어 문장을 읽고 알맞은 답을 찾는 연습이야.";
    let thinking = "문장에서 아는 단어를 먼저 찾고, 빈칸 앞뒤 뜻을 살펴보자.";
    let hints = [
      { title: "힌트 1", body: "문장에서 먼저 아는 단어를 동그라미 친다고 생각해 봐." },
      { title: "힌트 2", body: "앞뒤에 오는 단어를 보면 어떤 뜻의 말이 필요한지 알 수 있어." },
      { title: "힌트 3", body: "문장을 한국말로 짧게 바꿔 보고 가장 자연스러운 답을 골라 보자." },
    ];
    let check = "지금 가장 잘 맞는 단어가 무엇인지 한 번 말해볼래?";

    if (/blank|fill in|_+/.test(lower) || /_+/.test(typedText)) {
      summary = "빈칸에 들어갈 알맞은 단어를 찾는 문제";
      translation = "빈칸 앞뒤 뜻을 보고 어떤 말이 가장 자연스러운지 찾는 문제야.";
      thinking = "빈칸 바로 앞 단어와 뒤 단어를 같이 읽어 보자.";
      hints = [
        { title: "힌트 1", body: "빈칸 앞뒤 단어를 먼저 읽어 보자." },
        { title: "힌트 2", body: "들어갈 말의 뜻과 품사를 떠올려 보자." },
        { title: "힌트 3", body: "문장을 한국말로 바꿨을 때 가장 자연스러운 답을 골라 보자." },
      ];
      check = "어떤 단어를 넣으면 문장이 가장 자연스러울까?";
    } else if (/how many/.test(lower)) {
      summary = "개수나 숫자를 묻는 문제";
      translation = "몇 개인지 묻는 문제야.";
      thinking = "숫자와 셀 수 있는 대상을 같이 보자.";
      check = "몇 개라고 말하면 가장 자연스러울까?";
    } else if (/\bwhat\b/.test(lower)) {
      summary = "무엇인지 묻는 문제";
      translation = "`what`은 무엇인지 물을 때 쓰는 말이야.";
      thinking = "질문이 무엇을 알고 싶어 하는지 먼저 찾아보자.";
      check = "질문이 무엇을 묻는지 알겠니?";
    }

    const excerpt = typedText ? typedText.slice(0, 220) : "";
    if (excerpt && hints.length) {
      hints = [
        { title: hints[0].title, body: '읽은 문장은 "' + excerpt.slice(0, 60) + '" 야. ' + hints[0].body },
      ].concat(hints.slice(1));
    }

    return {
      recognizedProblemNumbers: recognized,
      selectedProblemNumber: selected,
      needsProblemNumberClarification: false,
      clarificationMessage: "",
      problemSummary: summary,
      translation: translation,
      coachIntro: "정답을 바로 보지 말고, 같이 단서를 먼저 찾아보자.",
      thinkingPrompt: thinking,
      hints: hints,
      checkQuestion: check,
      finalAnswer: {
        answer: "지금은 연습 모드라서 정답을 알려줄 수 없어요.",
        explanation:
          "어른에게 'Mac에서 Study Helper 켜기'를 부탁하면 Claude AI가 진짜 정답까지 도와줄 수 있어요. " +
          "그 전에는 위 힌트를 한 단계씩 보면서 스스로 답을 말해 보자.",
      },
      parentActionNeeded: true,
      parentSummary: "체험용 데모 코칭입니다. Mac 서버가 켜지면 Claude AI가 실제 분석을 제공합니다.",
      confidenceNote: "Mac에서 Study Helper 서버가 켜지면 Claude AI가 사진 속 실제 문제를 정확하게 분석해요.",
      sourceExcerpt: excerpt,
      mode: "demo",
    };
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/status") !== -1) {
      return Promise.resolve(
        jsonResponse({
          apiMode: "demo",
          model: "demo-coach",
          preferredBackend: "demo",
          message: "실제 AI 대신 화면 흐름을 보여주는 데모 모드예요.",
        })
      );
    }
    if (url.indexOf("/api/history") !== -1) {
      return Promise.resolve(jsonResponse({ sessions: [] }));
    }
    if (url.indexOf("/api/attempt") !== -1) {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    if (url.indexOf("/api/coach") !== -1) {
      let payload = {};
      try {
        payload = JSON.parse((init && init.body) || "{}");
      } catch (e) {
        payload = {};
      }
      // 실제 분석처럼 잠깐 기다렸다가 응답
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(jsonResponse(demoCoach(payload)));
        }, 1200);
      });
    }
    return realFetch(input, init);
  };
})();

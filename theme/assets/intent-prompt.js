(function () {
  "use strict";

  var PRODUCT_HANDLE = window.ONESELF_PRODUCT_HANDLE;
  if (!PRODUCT_HANDLE) return; // product pages only

  var BACKEND_URL = window.ONESELF_BACKEND_URL;
  if (!BACKEND_URL) return;

  var card = document.getElementById("oneself-intent-prompt");
  if (!card) return;

  var questionEl = card.querySelector(".oneself-intent-prompt__question");
  var optionsEl = card.querySelector(".oneself-intent-prompt__options");
  var dismissEl = card.querySelector(".oneself-intent-prompt__dismiss");
  var resultEl = card.querySelector(".oneself-intent-prompt__result");
  var resultMessageEl = card.querySelector(".oneself-intent-prompt__result-message");
  var resultAttributesEl = card.querySelector(".oneself-intent-prompt__result-attributes");

  var ATTRIBUTE_LABELS = {
    suitable_skin_types: "Suitable skin types",
    active_ingredients: "Active ingredients",
    active_strength: "Active strength",
    patch_test_note: "Patch test",
    routine_step: "Routine step",
    expected_timeline: "Expected timeline",
    price: "Price",
    size_ml: "Size (ml)",
    bundle_contents: "Bundle contents",
  };

  var DEBOUNCE_MS = 2000;
  var debounceTimer = null;
  var currentQuestionId = null;
  var answeredThisPage = false;

  function dismissedQuestionIds() {
    try {
      return JSON.parse(window.sessionStorage.getItem("oneself_dismissed_questions") || "[]");
    } catch (e) {
      return [];
    }
  }

  function markDismissed(questionId) {
    try {
      var ids = dismissedQuestionIds();
      if (ids.indexOf(questionId) === -1) ids.push(questionId);
      window.sessionStorage.setItem("oneself_dismissed_questions", JSON.stringify(ids));
    } catch (e) {
      // sessionStorage unavailable -- the prompt may reappear on poll; acceptable degradation.
    }
  }

  function hideCard() {
    card.hidden = true;
    currentQuestionId = null;
    resultEl.hidden = true;
    questionEl.hidden = false;
    optionsEl.hidden = false;
  }

  function showResult(ontology) {
    questionEl.hidden = true;
    optionsEl.hidden = true;

    resultAttributesEl.innerHTML = "";
    var verifiedKeys = Object.keys(ontology.verified || {});
    verifiedKeys.forEach(function (key) {
      var li = document.createElement("li");
      li.textContent = (ATTRIBUTE_LABELS[key] || key) + ": " + ontology.verified[key];
      resultAttributesEl.appendChild(li);
    });

    resultMessageEl.textContent = ontology.message || "";
    resultMessageEl.hidden = !ontology.message;
    resultEl.hidden = false;
    card.hidden = false;
  }

  function renderOptions(options) {
    optionsEl.innerHTML = "";
    options.forEach(function (option) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "oneself-intent-prompt__option";
      button.textContent = option.label;
      button.dataset.answerId = option.id;
      optionsEl.appendChild(button);
    });
  }

  function showCard(data) {
    currentQuestionId = data.question_id;
    questionEl.textContent = data.question;
    renderOptions(data.options);
    card.hidden = false;

    window.OneselfEvents.send("oneself:intent_prompt_shown", {
      product_handle: PRODUCT_HANDLE,
      payload: { question_id: data.question_id },
    });
  }

  function checkIntent() {
    if (answeredThisPage || (currentQuestionId && !card.hidden)) return;

    var sessionId = window.OneselfEvents.sessionId;
    var url = BACKEND_URL + "/intent?client_id=" + encodeURIComponent(sessionId) +
      "&product=" + encodeURIComponent(PRODUCT_HANDLE);

    fetch(url)
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data.ask) return;
        if (dismissedQuestionIds().indexOf(data.question_id) !== -1) return;
        showCard(data);
      })
      .catch(function () {});
  }

  document.addEventListener("oneself:signal", function () {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(checkIntent, DEBOUNCE_MS);
  });

  dismissEl.addEventListener("click", function () {
    var questionId = currentQuestionId;
    hideCard();
    if (questionId) {
      markDismissed(questionId);
      window.OneselfEvents.send("oneself:intent_dismissed", {
        product_handle: PRODUCT_HANDLE,
        payload: { question_id: questionId },
      });
    }
  });

  optionsEl.addEventListener("click", function (e) {
    var button = e.target.closest(".oneself-intent-prompt__option");
    if (!button) return;

    var questionId = currentQuestionId;
    var answerId = button.dataset.answerId;
    answeredThisPage = true;
    currentQuestionId = null; // answered, not dismissed -- don't mark it dismissed below

    window.OneselfEvents.send("oneself:intent_answered", {
      product_handle: PRODUCT_HANDLE,
      payload: { question_id: questionId, answer_id: answerId },
    });

    writeCartAttribute(questionId, answerId);
    storeAnswer(questionId, answerId);
  });

  function writeCartAttribute(questionId, answerId) {
    var attributes = {};
    attributes["oneself_intent_" + questionId] = answerId;
    fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attributes }),
    }).catch(function () {});
  }

  function storeAnswer(questionId, answerId) {
    fetch(BACKEND_URL + "/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: window.OneselfEvents.sessionId,
        question_id: questionId,
        answer_id: answerId,
        product_handle: PRODUCT_HANDLE,
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.ontology) showResult(data.ontology);
      })
      .catch(function () {});
  }
})();

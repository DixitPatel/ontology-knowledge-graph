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
    hideCard();

    window.OneselfEvents.send("oneself:intent_answered", {
      product_handle: PRODUCT_HANDLE,
      payload: { question_id: questionId, answer_id: answerId },
    });
  });
})();

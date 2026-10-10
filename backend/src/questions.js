// Question copy per PLAN.md §5. general_browsing has no question.
export const QUESTIONS = {
  skin_type_fit: {
    question: "What is your skin like?",
    options: [
      { id: "dry", label: "Dry" },
      { id: "oily", label: "Oily" },
      { id: "combination", label: "Combination" },
      { id: "sensitive", label: "Sensitive" },
    ],
  },
  irritation_risk: {
    question: "Has your skin reacted to acids before?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
      { id: "never_used_acids", label: "Never used acids" },
      { id: "not_sure", label: "Not sure" },
    ],
  },
  where_to_start: {
    question: "What are you working on?",
    options: [
      { id: "starting_a_routine", label: "Starting a routine" },
      { id: "adding_one_step", label: "Adding one step" },
      { id: "replacing_a_product", label: "Replacing a product" },
    ],
  },
  results_timeline: {
    question: "When do you want to see change?",
    options: [
      { id: "one_to_two_weeks", label: "1–2 weeks" },
      { id: "a_month", label: "A month" },
      { id: "no_rush", label: "No rush" },
    ],
  },
  value_check: {
    question: "What would help you decide?",
    options: [
      { id: "bundle_savings", label: "Bundle savings" },
      { id: "which_one_first", label: "Which one first" },
      { id: "size_or_duration", label: "Size / how long it lasts" },
    ],
  },
};

// Minimum confidence (score of the top hypothesis) before we ask -- below
// this the signal is too weak to distinguish from general_browsing.
export const ASK_THRESHOLD = 0.34;

// Static English guidance. Original source URLs remain in server/pufu-guideline.ts.
export const pufuGuidelineEn = {
  principles: {
    principles: {
      label: 'Basic principles',
      definition:
        "A pufu expresses the participant's intent, current circumstances, desired future and actions toward it.",
      guidance: [
        'Use it as a snapshot of current understanding and direction, updated through experimentation, rather than a procedure manual or WBS.',
        "Respect the participant's values, language and context; do not replace them with generic AI advice.",
        "Distinguish facts, the participant's understanding, AI assumptions and unknowns. Do not invent missing information or present it as settled.",
        'Keep key content concise so the whole picture fits on one sheet. Causal links between measures and states are hypotheses, not guarantees of success.',
        'Consult these guidelines when creating or editing. Use get_pufu for interpretation and show_pufu for display; reading the JSON is not required merely to display it.',
        "Reading a pufu must not automatically modify it. Follow the user's requested scope and preserve existing intent, structure and unchanged fields when editing.",
        'The create_pufu / update_pufu input schemas are authoritative for JSON structure, UUIDs, colors, progress and other format constraints.',
      ],
      process: [
        "Understand the participant's interests and project background through questions, stocks and conversation.",
        'Outline possible gaining goals.',
        'Understand current conditions, resources and constraints through the eight planning elements.',
        "Consider a win condition as a hypothesis and check alignment with the participant's wishes.",
        'Organize the states required for the win condition into intermediate purposes.',
        'Consider measures contributing to each intermediate purpose.',
        'Check consistency, priorities and readability of the whole. Do not invent missing information.',
        'Create, register or update within the requested scope.',
      ],
      checks: [
        "Has the participant's intent been changed without permission?",
        'Have assumptions been presented as facts?',
      ],
    },
  },
  goals: {
    gainingGoal: {
      label: 'Gaining goal',
      definition: 'An artifact or outcome that the effort aims to produce or obtain.',
      guidance: [
        'Make clear what is to be gained. This can include services, organizations, businesses and experiences as well as tangible products.',
        'Distinguish it from the win condition describing the desired state after use. Avoid a detailed feature list or WBS.',
        'It may remain ambiguous while the content is undecided.',
      ],
      examples: ['Pufu Lens, a web service for managing questions and pufus together.'],
      checks: [
        'Does it describe what is to be obtained?',
        'Is it distinguished from the state beyond delivery of the artifact?',
      ],
    },
    winCondition: {
      label: 'Win condition',
      definition: 'A desirable situation that lets the participant feel the effort has succeeded.',
      guidance: [
        'Describe the situation sought through obtaining the gaining goal. Do not judge success solely by completion or delivery.',
        'Aim for wording that conveys meaning and feasibility and helps generate priorities and measures.',
        'Qualitative or metaphorical wording is acceptable. Do not impose numerical targets, KPIs or SMART criteria.',
        'Treat an unsettled win condition as a hypothesis.',
      ],
      examples: [
        'Users develop questions from everyday interests and connect selected questions to concrete action.',
      ],
      checks: [
        'Would the participant recognize this state as success?',
        'Does it go beyond restating completion of the gaining goal?',
      ],
    },
  },
  purposes: {
    purposes: {
      label: 'Intermediate purposes',
      definition: 'Partial states that need to be fulfilled for the win condition to hold.',
      guidance: [
        'Describe what needs to be in what state, rather than naming tasks, features or work items.',
        'Consider balanced perspectives and priorities. Around two or three are generally recommended.',
        'Four or more are allowed. Consider grouping for readability, but do not add items just to meet a count.',
      ],
      examples: [
        'Users can discover questions aligned with their interests.',
        'Users can turn selected questions into pufus and consider action.',
        'People and AI can converse while carrying forward past thinking.',
      ],
      checks: [
        'Does it express a state rather than a task?',
        'Does it contribute to the win condition while keeping the whole readable?',
      ],
    },
  },
  measures: {
    measures: {
      label: 'Measures',
      definition: 'Concrete actions to realize the corresponding intermediate purpose.',
      guidance: [
        'Make the action clear and be able to explain its relationship to the corresponding intermediate purpose.',
        'Treat the effect as a working hypothesis, not a guaranteed outcome. Consider alternatives instead of fixating on one method.',
        'Consider cost, time and feasibility without trying to enumerate every task.',
        'For an initial draft, aim for roughly one to three per intermediate purpose. This is a Pufu Lens operational recommendation, not a mandatory constraint.',
      ],
      examples: [
        'Display relationships between stocks and questions visually.',
        'Provide a path from a question to creating a pufu.',
        'Make stocks, questions and pufus accessible through MCP.',
      ],
      checks: [
        'Is there a plausible contribution to the corresponding intermediate purpose?',
        'Have alternatives and execution costs been considered?',
      ],
    },
  },
  elements: {
    elements: {
      label: 'Eight planning elements',
      definition:
        'The currently understood resources, conditions and constraints surrounding the project.',
      guidance: [
        'Write the current understanding rather than ideals or measures. Where useful, consider requirements, constraints, favorable conditions and unfavorable conditions.',
        "Distinguish facts, the participant's understanding and AI assumptions. Empty fields are acceptable when information is unavailable; do not invent content to fill all eight elements.",
        'Distinguish rivals from external enemies. Do not automatically classify general uncertainty or work issues as external enemies.',
      ],
      items: {
        people: {
          label: 'People',
          definition:
            'The abilities, strengths, weaknesses, motivations, interests, concerns, values and behavioral principles of participants and stakeholders.',
          guidance: [
            'Describe known characteristics and relationships, beyond merely listing participants.',
          ],
          checks: ['Have abilities or motivations been assumed without evidence?'],
        },
        money: {
          label: 'Money',
          definition:
            'Conditions and constraints relating to budgets, costs, funding, income and expenses.',
          guidance: ['Do not generate monetary amounts without evidence.'],
          checks: ['Are monetary amounts and funding conditions supported?'],
        },
        time: {
          label: 'Time',
          definition: "Deadlines, lead times, participants' available time and time margins.",
          guidance: ['Do not invent deadlines that have not been set.'],
          checks: ['Have deadlines and available time been confirmed?'],
        },
        quality: {
          label: 'Quality',
          definition:
            'Expected quality, completeness, satisfaction and technical standards of the artifact, and the conditions constraining them.',
          guidance: ['Consider existing technology and limits on feasible quality.'],
          checks: ['Are quality expectations distinguished from current conditions?'],
        },
        businessScheme: {
          label: 'Business structure',
          definition:
            'Contractual relationships, responsibilities, decision rights, chains of command and relationships between organizations.',
          guidance: ['Describe currently understood roles, authority and relationships.'],
          checks: ['Have unconfirmed contracts or authority been assumed?'],
        },
        environment: {
          label: 'Environment',
          definition:
            'Culture, climate, customs, institutions and external conditions in the domain, country, region, industry or organization.',
          guidance: ['Organize the current external conditions affecting the effort.'],
          checks: ['Have environmental conditions been asserted solely from generalizations?'],
        },
        rival: {
          label: 'Rivals',
          definition: 'Entities competing for the same outcomes or resources.',
          guidance: [
            'They may also collaborate or interact; do not automatically regard them as adversaries.',
          ],
          checks: ['Are they distinguished from external enemies?'],
        },
        foreignEnemy: {
          label: 'External enemies',
          definition:
            'Entities or circumstances actively hindering achievement of the goal or survival of the project.',
          guidance: [
            'Distinguish them from rivals and do not automatically classify general uncertainty or ordinary work issues here.',
          ],
          checks: ['Is there evidence for the understanding that they actively hinder the effort?'],
        },
      },
      examples: [
        'If budgets or deadlines are unconfirmed, state that or leave them blank instead of inventing figures.',
      ],
      checks: [
        'Does the content stay with the current understanding?',
        'Have unknowns been filled with assumptions?',
      ],
    },
  },
  review: {
    review: {
      label: 'Review checks',
      definition:
        'Questions supporting improvement, rather than mechanical correctness tests or grounds to reject saving.',
      guidance: [
        "Check the participant's intent, element meanings and relationships, uncertainty and readability; propose improvements where needed.",
        "Do not automatically modify existing pufus merely from reading guidelines or reviewing them. Respect the user's requested scope.",
      ],
      checks: [
        'Are gaining goals and win conditions distinguished?',
        'Do intermediate purposes express states rather than tasks?',
        'Does each measure plausibly contribute to its corresponding intermediate purpose?',
        'Are assumptions in the eight planning elements distinguished from facts?',
        'Are rivals and external enemies distinguished?',
        'Are excessive important points making the overall picture difficult to read?',
        "Has the participant's intent or context been changed without permission?",
      ],
    },
  },
};

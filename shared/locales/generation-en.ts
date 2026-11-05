import type { generationJa } from './generation-ja';

export const generationEn = {
  'memory.interest': 'Collected articles about “{{topic}}”: {{count}}.',
  'memory.empty': 'Interests and knowledge will appear here as article summaries are completed.',
  'memory.interests': 'Interests',
  'memory.knowledge': 'Knowledge from articles',
  'memory.questions': 'Open questions',
  'question.template':
    'What conditions or tests would be needed to apply “{{point}}” to “{{project}}”{{note}}?',
  'question.note': ', considering the saved note',
  'pufu.inferredGoal': 'Hypothesis: build a way to address the issue suggested by “{{reference}}”.',
  'pufu.knowledge': 'Gather evidence and test the hypothesis.',
  'pufu.winCondition':
    'Achievement of “{{task}}” can be confirmed through evidence and test results addressing the original question.',
  'pufu.purpose.examine': 'The assumptions and points requiring verification are clear.',
  'pufu.measure.examine': 'Break “{{question}}” into questions that can be checked.',
  'pufu.measure.evidence':
    'Review the question, {{stock}}and evidence in memory. Reference: {{knowledge}}',
  'pufu.stock': 'the stock “{{title}}”, ',
  'pufu.purpose.verify': 'Run a small test and explain the results.',
  'pufu.measure.verify': 'Define success criteria and run one minimal test.',
  'pufu.measure.record': 'Record the results and remaining questions, then decide the next step.',
  'pufu.people':
    'Owners and collaborators are unconfirmed. Consult someone with the needed expertise.',
  'pufu.money': 'The budget is unset. Start with a test that incurs little additional cost.',
  'pufu.time':
    'Deadlines and available time are unset. Estimate the time needed for the first test.',
  'pufu.quality': 'Address the original question with evidence and test results.',
  'pufu.businessScheme': 'Use the results in line with the purpose of “{{project}}”.',
  'pufu.environment': 'Project background: {{description}}',
  'pufu.description.empty': 'Details are unset.',
  'pufu.rival': 'Competing efforts and alternatives are unconfirmed. Identify options to compare.',
  'pufu.foreignEnemy':
    'Hypothesis: missing information or different test conditions may hinder judgment.',
  'pufu.hypothesis': 'Hypothesis: ',
  'pufu.unknown': 'Unconfirmed',
  'pufu.referenceText': 'Reference example: {{text}}',
  'pufu.measureSource':
    'Source: {{source}}. An activity described in the source; execution plans and applicability are unconfirmed.',
  'pufu.conditionSource':
    'Source: {{source}}. Applicability to your own conditions needs confirmation.',
  'pufu.inputComment': 'Preserves the gaining goal entered by the user.',
  'pufu.inferredComment': 'A hypothetical gaining goal inferred from the question and stock.',
  'pufu.hypothesisComment': 'A hypothetical state organized from the input and references.',
  'pufu.unknownComment': 'No usable supporting evidence was found in the references.',
  'pufu.incompleteContent':
    'Only part of the article was retrieved. Subsequent pages have not been verified.',
  'pufu.excerptedContent':
    'Long articles are referenced through excerpts from the beginning, middle and end.',
} satisfies Record<keyof typeof generationJa, string>;

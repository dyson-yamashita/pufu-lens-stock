import type { FaqCategory } from '../faq';

export const faqEn: readonly FaqCategory[] = [
  {
    id: 'service',
    title: 'About PufuLens and its uses',
    entries: [
      {
        id: 'about',
        question: 'What is PufuLens?',
        answer:
          'PufuLens is a web app for saving information and thoughts that interest you, exploring questions with AI, and turning them into concrete actions.',
      },
      {
        id: 'features',
        question: 'What can I do with it?',
        answer:
          'The main features are Stocks for saving articles and notes, Questions/Insights for recording questions and ideas, and Pufu for organizing goals and actions. AI can also summarize content and organize your interests and knowledge in Memory.',
      },
      {
        id: 'transcription-ocr',
        question:
          'Can PufuLens transcribe video or audio, or read text from images and scans (OCR)?',
        answer: [
          'PufuLens currently does not offer video or audio transcription or OCR for images and scanned PDFs. Use an AI service that supports your file to transcribe it or extract its text. Then ask ChatGPT, Claude, or another AI service connected to PufuLens via MCP to save the text. For example, “Save this text as a Stock in the [project name] project.” ',
          'See the ',
          { text: 'MCP setup instructions in the user manual', href: '/en/manual#integrations' },
          '.',
        ],
      },
      {
        id: 'audience',
        question: 'Who is it for?',
        answer:
          'It is intended for people who want to turn research into learning, organize their thinking, or start a new activity or project.',
      },
      {
        id: 'use-cases',
        question: 'When can I use it?',
        answer:
          'You can collect interesting articles, record questions from reading or learning, and plan activities for work or hobbies.',
      },
      {
        id: 'bookmarks',
        question: 'How is it different from bookmarks or notes?',
        answer:
          'AI suggests summaries and questions based on what you save, helping you connect information to further thinking and action plans.',
      },
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing and usage limits',
    entries: [
      {
        id: 'free',
        question: 'Can I use it for free?',
        answer:
          'PufuLens features are free to use. You need to arrange the external services used for MCP and social media integrations yourself. Those services may charge separately depending on the service and subscription plan.',
      },
      {
        id: 'limits',
        question: 'Are there usage or saving limits?',
        answer:
          'Currently, you can have up to 50 projects and make up to 200 new saves in a rolling 24-hour period. AI generation also has usage limits.',
      },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    entries: [
      {
        id: 'sign-in',
        question: 'Do I need to register or sign in?',
        answer:
          'Normal use requires signing in with a Google account. On your first visit, register a nickname and agree to the Terms of Service and Privacy Policy to get started.',
      },
      {
        id: 'experience',
        question: 'Do I need specialist knowledge or a complete plan?',
        answer:
          'You do not need a finished plan. Start wherever feels easiest: save an article, note a question, or organize a goal.',
      },
      {
        id: 'devices',
        question: 'Can I use it on a phone or computer?',
        answer:
          'PufuLens is a browser-based web app with controls for smartphones. Chrome is recommended, or Safari on iOS.',
      },
      {
        id: 'installation',
        question: 'Do I need to install an app?',
        answer:
          'For basic use, open the website in your browser. Features such as external AI integrations may require additional setup.',
      },
      {
        id: 'manual',
        question: 'Where can I learn how to use it?',
        answer: [
          'The ',
          { text: 'user manual', href: '/en/manual' },
          ' explains how to perform tasks by purpose.',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Personal information and privacy',
    entries: [
      {
        id: 'personal-data',
        question: 'What personal information do you collect?',
        answer:
          'Google sign-in obtains and stores an account identifier to identify you. Our policy is not to request, store, or use your Google email address, name, or profile image. Profile information and content you enter yourself are recorded.',
      },
      {
        id: 'nickname',
        question: 'Can I use it without sharing my real name?',
        answer: 'Yes. Your display name is a nickname; entering your real name is not required.',
      },
      {
        id: 'storage',
        question: 'Where is my information stored?',
        answer:
          'Information is stored using Cloudflare databases and storage. It may also be processed outside Japan.',
      },
      {
        id: 'publication',
        question: 'Will my saved information be published automatically?',
        answer:
          'Projects are private by default. If you publish a project, its Stocks, Questions/Insights, related Pufu, and other public content become viewable without signing in.',
      },
      {
        id: 'third-parties',
        question: 'Is information shared with third parties?',
        answer:
          'Our policy is not to provide information to third parties except for processing needed to deliver the service, integrations or publication you authorize, or where required by law. Information needed for AI processing is sent to Cloudflare Workers AI.',
      },
      {
        id: 'ai-training',
        question: 'Is my information used to train AI?',
        answer:
          'Cloudflare Workers AI states that it does not use the user content it processes to train AI models. When you connect an external AI service, that service’s terms and settings also apply.',
      },
      {
        id: 'deletion',
        question: 'Can I delete my data or account?',
        answer:
          'Yes. You can delete saved content from its corresponding screen and delete your account from Profile. Signing out or disconnecting Google alone does not delete saved data.',
      },
    ],
  },
  {
    id: 'support',
    title: 'Operator, contact, and support',
    entries: [
      {
        id: 'operator',
        question: 'Who operates PufuLens?',
        answer:
          'The developer, Yamashita, publishes articles about its development. The operator is identified in the terms as “Pufu Lens Operator.”',
      },
      {
        id: 'contact',
        question: 'Can I contact the operator?',
        answer: [
          'Please contact ',
          { text: 'pufu-lens@haluworks.com', href: 'mailto:pufu-lens@haluworks.com' },
          ' with inquiries.',
        ],
      },
      {
        id: 'policies',
        question: 'Where can I read the terms and privacy policy?',
        answer: [
          'See the ',
          { text: 'Terms of Service', href: '/en/terms' },
          ' and ',
          { text: 'Privacy Policy', href: '/en/privacy' },
          ' pages.',
        ],
      },
      {
        id: 'feedback',
        question: 'Can I ask for help or report a problem?',
        answer:
          'The app provides guidance and feedback through Pufi, as well as contact information for inquiries.',
      },
    ],
  },
  {
    id: 'data',
    title: 'Saved data, generated content, and service continuity',
    entries: [
      {
        id: 'downloads',
        question: 'Can I download what I create?',
        answer: 'You can download Pufu as JSON or PNG and Memory as text.',
      },
      {
        id: 'rights',
        question: 'Who owns the content I save or create?',
        answer:
          'Rights to registered content belong to you or the original rights holder. For publication or commercial use, check the rights to source information and materials and the terms of external services.',
      },
      {
        id: 'accuracy',
        question: 'How reliable is AI-generated content?',
        answer:
          'Summaries and suggestions may contain errors, omissions, or bias. Check the original text and supporting information, and use your own judgment.',
      },
      {
        id: 'closure',
        question: 'What happens to my data if the service ends?',
        answer:
          'The terms provide for advance notice of significant changes or closure, except in emergencies and similar circumstances. Complete preservation of data is not guaranteed, so keep your own copies of important information.',
      },
    ],
  },
];

export const legalEn = {
  privacy: [
    {
      id: 'scope',
      title: '1. About this policy',
      blocks: [
        {
          type: 'paragraph',
          text: "The operator of Pufu Lens (the “Operator”) handles users' information as described below in providing Pufu Lens (the “Service”), which collects articles and text and uses AI to create summaries, questions, insights, memories and Pufu scores.",
        },
      ],
    },
    {
      id: 'collected-data',
      title: '2. Information collected and stored',
      blocks: [
        {
          type: 'list',
          items: [
            'Google sign-in information: We collect and store only the Google account identifier needed to identify the user. We do not request, store or use the Google email address, name or profile image, and do not access Gmail or Google Drive content. We do not store Google passwords, access tokens or refresh tokens.',
            'Information supplied by users: We store the nickname (display name) and bio that users enter; project names, descriptions, publication settings and public introductions; saved URLs, text, notes, comments and favorites; questions, insights, tasks, Pufu scores and reflections. We record the versions of the terms and privacy policy accepted when starting the Service and the acceptance time. We also store the selected account language.',
            "Retrieved articles and generated results: We store article bodies, titles and other information retrieved from saved URLs, and AI-generated summaries, key points, topics, questions, insights, memories and Pufu scores. We store YouTube URLs and user-written notes. Videos are shown in the browser's YouTube embedded player; the Service's servers do not retrieve or store video metadata, video files or captions.",
            'Integrations and usage: We store registered X credentials, API token verification data, permitted MCP connection permissions, selected projects and usage times, login sessions, save/AI usage counts and processing status. Registered X credentials are encrypted at rest.',
          ],
        },
      ],
    },
    {
      id: 'google-user-data',
      title: '3. Google user data',
      blocks: [
        {
          type: 'paragraph',
          text: "Pufu Lens receives information through Google sign-in when the user authorizes it on Google's consent screen. The only requested scope is `openid`. We do not request access to Google Workspace data such as Gmail, Google Drive or Google Calendar.",
        },
        {
          type: 'list',
          items: [
            'Information and purpose: The Google account identifier (`sub`) identifies the account and associates it with saved data. We do not request Google email addresses, names or profile images, and do not store or use them even if a prior authorization causes them to appear in an authentication response. We do not obtain Google passwords.',
            'Storage and protection: Google account identifiers are stored in Cloudflare D1 and protected by per-user access control and HTTPS. Google authentication tokens are handled temporarily for sign-in and are not retained for ongoing access.',
            'AI processing: Google identifiers are not used as AI-generation inputs. The bio entered by the user is sent to Cloudflare Workers AI to generate user memory. Nicknames are not inputs to user-memory generation.',
            'Sharing and use restrictions: Google user data is used only as needed for authentication, account management and user-facing features. Cloudflare processes and stores this information on our behalf. We do not sell Google user data or use/share it for advertising, credit assessment or lending. We do not use or share it for the development, improvement or training of general-purpose AI or machine-learning models. Google Workspace API data is likewise not used for these purposes.',
            "Retention and deletion: Google sign-in information is retained while the account exists and deleted when the account is deleted from Profile. Users can also revoke access in their Google account's connection settings; revoking access alone does not delete saved data. See [Retention, deletion and disconnecting](#retention).",
          ],
        },
        {
          type: 'paragraph',
          text: "Pufu Lens's use and transfer to other apps of information received from Google APIs complies with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.",
        },
      ],
    },
    {
      id: 'purposes',
      title: '4. Purposes of use',
      blocks: [
        {
          type: 'list',
          items: [
            'Authentication, maintaining sign-in and managing data separately for each user.',
            'Retrieving, saving, searching and displaying articles; generating/displaying summaries, questions, insights, memories and Pufu scores.',
            'Publishing projects and connecting external services as configured by the user.',
            'Enforcing usage limits, preventing abuse, responding to incidents and handling inquiries.',
          ],
        },
      ],
    },
    {
      id: 'processors',
      title: '5. External services and AI processing',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Service uses Cloudflare infrastructure for delivery, databases, storage and AI. To the extent needed for AI generation, article bodies, titles, summaries, notes, project names/descriptions, bios, memories, questions, insights, tasks and Pufu scores may be sent to Cloudflare Workers AI. The profile bio is used to generate user memory. Do not enter confidential information or personal information that you do not have permission to transmit.',
        },
        {
          type: 'paragraph',
          text: 'Google sign-in information is used for the purposes stated above and is not sold to third parties. We do not provide user information to third parties except for service providers needed to operate the Service, integrations/publication authorized by the user, or where required by law. External service infrastructure may process information outside Japan.',
        },
        {
          type: 'list',
          items: [
            "Google: Used for sign-in. See [Google's Privacy Policy](https://policies.google.com/privacy).",
            "Cloudflare: Delivers the Service, stores data and performs AI processing. See [Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/) and [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/).",
            "YouTube: Lists load thumbnails from YouTube's delivery servers, sending information such as IP addresses and browser details to Google. Video details use the privacy-enhanced embedded player. Loading or playing the player connects the browser to YouTube and may send the IP address, browser details and referring-site information to Google. See [Google's Privacy Policy](https://policies.google.com/privacy).",
            "X: User-registered credentials are sent to the X API to retrieve specified posts. X handles information under [X's Privacy Policy](https://x.com/ja/privacy).",
            "MCP destinations such as ChatGPT: Stocks, summaries, questions, insights and other permitted information are returned within the operations and projects authorized by the user. Consult the destination's terms and policies for its handling of that data.",
          ],
        },
      ],
    },
    {
      id: 'publication',
      title: '6. Publishing a project',
      blocks: [
        {
          type: 'paragraph',
          text: "Publishing makes the project name and public introduction; stock titles, URLs, summaries, key points and topics; questions and insights; and all phases and reflections of linked Pufu scores accessible without signing in. The project is also listed on the home page's public-project directory. Before publishing, check for confidential information and third parties' personal information.",
        },
        {
          type: 'paragraph',
          text: "Memories, private notes, retrieved article bodies and internal project descriptions are not published. Turning publication off and saving removes access through the Service's public pages. We may be unable to delete copies already made by third parties or search-engine caches.",
        },
      ],
    },
    {
      id: 'cookies',
      title: '7. Cookies, browser storage and connection information',
      blocks: [
        {
          type: 'paragraph',
          text: 'We use cookies to maintain sign-in (30-day validity) and temporary cookies to secure Google sign-in (10 minutes). The display theme is stored in browser local storage and a cookie (one year). Your language preference is saved in browser local storage. Disabling cookies may prevent sign-in or other features.',
        },
        {
          type: 'paragraph',
          text: 'Page delivery, loading Google Fonts or the YouTube embedded player, and following external links may send IP addresses, browser details and similar information to the relevant providers. Infrastructure providers such as Cloudflare handle connection logs for secure delivery and incident response. The Service does not include its own advertising or advertising-purpose analytics. YouTube may display its own ads inside the embedded player.',
        },
      ],
    },
    {
      id: 'retention',
      title: '8. Retention, deletion and disconnecting',
      blocks: [
        {
          type: 'paragraph',
          text: 'Registration information and saved content are retained for as long as needed to provide the Service. Stocks, questions, insights, Pufu scores and projects can be deleted from their respective screens. To delete only a Pufu score, open “Other actions” in its details. Deleting a stock or project also deletes related questions, insights and Pufu scores. Articles referenced in other projects remain while those saved references exist. Unreferenced article bodies are deleted and related memories updated asynchronously. Usage history needed to prevent abuse or information required by law may be retained as necessary after content deletion.',
        },
        {
          type: 'list',
          items: [
            'Profile details can be changed and the bio removed in Profile.',
            'MCP connections and registered X credentials can be disconnected in Integrations. API tokens can be revoked in Shortcut integration. Disconnecting does not delete saved stocks or data already received by the destination.',
            'Google access can be revoked in [Google account connections](https://myaccount.google.com/connections). Revoking Google access or signing out does not delete information stored in the Service.',
            'Delete the account from Profile → Delete account to remove registration data and stored bodies and disable integrations. Background cleanup may continue until deletion is complete. Deleted data cannot be recovered.',
            'Contact the address below for disclosure, correction, deletion or suspension requests unavailable in the UI. We verify identity and respond under applicable law.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: '9. Security',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Operator works to prevent unauthorized access and disclosure through encrypted communication, per-user access control and protection of credentials. Users should also protect their Google accounts and integration tokens and not share them with others.',
        },
      ],
    },
    {
      id: 'changes',
      title: '10. Policy changes',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Operator may revise this policy to reflect changes in law or the Service. Important changes will be announced appropriately, including through the Service, and consent obtained where required by law. The current policy and revision date appear on this page.',
        },
      ],
    },
    {
      id: 'contact',
      title: '11. Operator and inquiries',
      blocks: [
        {
          type: 'paragraph',
          text: "Operator: Pufu Lens operator. Contact: the user-support email shown on Google's sign-in consent screen. Contact this address for disclosure, correction, deletion, suspension or questions about the Service.",
        },
      ],
    },
  ],
  terms: [
    {
      id: 'application',
      title: 'Article 1. Application and consent',
      blocks: [
        {
          type: 'paragraph',
          text: 'These Terms of Service (the “Terms”) govern the use of Pufu Lens (the “Service”) provided by the Pufu Lens operator (the “Operator”). To start, review these Terms and the [Privacy Policy](/en/privacy), enter a nickname (display name) after first sign-in, check both consent boxes and press OK. The registration screen is shown again on subsequent sign-ins until registration and consent are complete. Choose your display language during the same registration flow.',
        },
      ],
    },
    {
      id: 'service',
      title: 'Article 2. Service',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Service provides saving articles and text, organizing them by project, AI-generated summaries, questions, insights, memories and Pufu scores, publishing projects and connecting external services. For YouTube, it saves URLs and notes, displays thumbnails in lists and the embedded YouTube player in details. Its servers do not retrieve or store video metadata or generate summaries, questions, insights or memories from video content. If the user writes a note, only that note is used in memory updates. Some videos may not support embedded playback. Features may require Google sign-in or external-service configuration/permissions. Usage and AI processing are limited; features may be unavailable due to external-service specifications or status. Users bear their connection costs and external-service subscription costs.',
        },
      ],
    },
    {
      id: 'account',
      title: 'Article 3. Accounts and integrations',
      blocks: [
        {
          type: 'paragraph',
          text: 'Users must protect their Google accounts and integration tokens. When connecting an external service, review the permitted operations and selected projects. If misuse is suspected, disconnect/revoke the relevant integration and contact the Operator.',
        },
      ],
    },
    {
      id: 'rights',
      title: 'Article 4. Rights in saved and published content',
      blocks: [
        {
          type: 'paragraph',
          text: 'Rights in registered content belong to the user or original rights holder. Users are responsible for choosing sources and confirming the rights/permission needed to retrieve, save and use them. Secure necessary rights and permissions for saving, entering and publishing information and comply with copyright, privacy, confidentiality duties and source terms. Being able to save a URL does not grant permission to freely republish its content.',
        },
        {
          type: 'paragraph',
          text: 'Users authorize the Operator to handle registered content as needed for storage, display, AI generation, authorized integrations, publication and other provision of the Service. Enabling publication makes summaries, questions, insights, Pufu scores and other published information accessible without sign-in. Review the [publication scope](/en/privacy#publication) and check for personal/confidential information or rights infringements before publishing.',
        },
      ],
    },
    {
      id: 'ai',
      title: 'Article 5. AI-generated information',
      blocks: [
        {
          type: 'paragraph',
          text: 'AI-generated summaries, questions, insights, memories and Pufu scores may contain errors, omissions or bias. The Operator does not guarantee accuracy, completeness or fitness for a particular purpose. Compare results with original text and reliable sources, seek professional advice where needed, and use your own judgment. Information sent to external AI processing is described in the [Privacy Policy](/en/privacy#processors).',
        },
      ],
    },
    {
      id: 'prohibited',
      title: 'Article 6. Prohibited conduct',
      blocks: [
        {
          type: 'list',
          items: [
            'Violating laws, public order, good morals or these Terms.',
            "Infringing another party's copyright, privacy, reputation or other rights.",
            'Unauthorized access, impersonation, or unauthorized use/sharing of credentials.',
            'Sending harmful programs, overloading the Service or bypassing usage limits.',
            'Retrieving, saving or publishing information without authority, or violating external-service terms/access restrictions.',
            "Interfering with operation of the Service or other users' use.",
          ],
        },
      ],
    },
    {
      id: 'external-services',
      title: 'Article 7. External services',
      blocks: [
        {
          type: 'paragraph',
          text: "Google, Cloudflare, X, ChatGPT and other external services are subject to their own terms. Use of YouTube's embedded player is subject to the [YouTube Terms of Service](https://www.youtube.com/t/terms). Changes, interruptions or restrictions in external services may make features unavailable. Consult destinations' features and policies for management/deletion of data sent to them.",
        },
      ],
    },
    {
      id: 'suspension',
      title: 'Article 8. Changes, interruption and restrictions',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Operator may change, suspend or end the Service for maintenance, incidents, security responses, external-service interruptions or other reasons. Important changes or termination will be announced in advance through the Service or another appropriate method, except in emergencies or unavoidable circumstances. If violations or abuse are confirmed, use may be restricted or public content hidden to the extent necessary to prevent harm.',
        },
      ],
    },
    {
      id: 'liability',
      title: 'Article 9. Warranties and liability',
      blocks: [
        {
          type: 'paragraph',
          text: "The Operator does not guarantee continuous availability, complete preservation of saved information, or accuracy of external content or AI results. Keep your own copies of important information. Liability concerning the Service is governed by applicable law. These Terms do not exclude or limit liability for the Operator's intent or gross negligence, or liability that consumer-protection law does not permit to be excluded or limited.",
        },
      ],
    },
    {
      id: 'termination',
      title: 'Article 10. Ending use and deleting data',
      blocks: [
        {
          type: 'paragraph',
          text: "Users may stop using the Service at any time. Delete saved content from the relevant screens and disconnect external services in their settings. Contact the address below for procedures unavailable in the UI, including account-information deletion. Signing out or revoking Google access alone does not delete saved data. See the [Privacy Policy's deletion guidance](/en/privacy#retention).",
        },
      ],
    },
    {
      id: 'changes',
      title: 'Article 11. Changes to these Terms',
      blocks: [
        {
          type: 'paragraph',
          text: 'The Operator may change these Terms under applicable law. Changes and their effective date will be announced beforehand through the Service or another appropriate method; consent will be obtained where required by law.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Article 12. Governing law',
      blocks: [
        {
          type: 'paragraph',
          text: 'These Terms are governed by Japanese law, without impairing rights users hold under applicable mandatory laws.',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Article 13. Operator and inquiries',
      blocks: [
        {
          type: 'paragraph',
          text: "Operator: Pufu Lens operator. Contact: the user-support email shown on Google's sign-in consent screen. Use this address for disclosure, correction, deletion, suspension or questions about the Service.",
        },
      ],
    },
  ],
} as const;

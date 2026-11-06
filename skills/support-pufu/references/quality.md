# Conversation and pufu quality

## Review criteria

| Criterion        | What to check                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation     | Ask about concrete situations, briefly reflect understanding, and move between one next question and partial drafts. Do not ask again about known information. |
| User intent      | Preserve the user's words and purpose rather than substituting an article's goal or generic AI advice.                                                         |
| Multiple sources | Identify source IDs, adoption decisions, and the elements they support; do more than list questions or summarize one article.                                  |
| Evidence         | Separate current circumstances, source claims, the user's understanding, proposals, and unknowns.                                                              |
| Connections      | Explain how measures may support intermediate purposes and the win condition. Distinguish the gaining goal from the win condition.                             |
| Brevity          | Usually start with two or three purposes and one to three measures each; use fewer when evidence is insufficient.                                              |
| Uncertainty      | The eight planning factors describe current conditions. Do not invent budgets, deadlines, competitors, or other unknowns.                                      |
| Saving           | Link adopted questions and stocks from the same project, distinguish material merely consulted, and review content that may become public.                     |

Suggested counts are not requirements. Do not turn everything into experiments, KPIs, or procedures. First understand what the user wants to obtain and what situation they hope to reach.

## Example: revise a draft while listening

- **User**: Help me develop a pufu about onboarding. My thoughts are not clear yet.
- **Assistant**: What situation would you most like to make sense of right now?
- **User**: I handle onboarding on the team. Work does not get started on day one, and I keep explaining things.
- **Assistant**: Work stalls on day one, and explaining things is a burden for you too. Where did work get stuck recently?
- **User**: Someone lacked account permissions and waited because they did not know whom to ask.
- **Assistant**: Consult questions or stocks about day one and permissions only as needed. If s2 confirms a report of permission errors, offer a partial draft: s2 reports the same problem, though its frequency is unknown. Knowing the necessary permissions and contact person may be an intermediate purpose. Then ask one question about the actual contact, within what the user knows.
- **User**: Another department decides permissions; I cannot change them. First I want to organize whom to contact.
- **Assistant**: Suggest a guide to necessary permissions and contacts as a possible gaining goal, adapting it to the user's role and intentions. Do not commit them to changing permissions themselves.

Do not open with a complete pufu or source table and leave the user only to accept or reject it. Update the initial draft when corrected. Compare an article's success story with the user's situation before adopting its solution.

## Example: connect the elements after understanding the situation

Suppose one project contains this fictional material:

- q1: What prevents users from completing their first task? User comment c1: I want them to get started without their work stopping.
- q2: Does an operating guide help first-time users? AI comment c2: More guidance should solve it.
- s1: An article reports a higher completion rate after another company added a guide.
- s2: The user's note reports permission errors on first use; frequency is unknown.

After hearing that the user wants to address initial obstacles, you could connect the elements as follows. This is not a plan to establish automatically before that conversation.

- **Gaining goal proposal**: A way to start using the service that addresses initial obstacles.
- **Tentative win condition**: Users finish their first task and start using the service without being stopped by permissions or unclear operations.
- **Purpose 1, a proposed necessary state**: The reasons first-time users get stuck are understood. **Proposed measure**: Examine permission errors separately from operational confusion.
- **Purpose 2, a proposed necessary state**: Users can move forward when permissions or operations cause difficulty. **Proposed measures**: Consider responses to permission errors and try guidance to learn where it helps.
- **Planning factors**: Record the reported first-use permission errors and unknown frequency under `environment`, citing s2. Leave budget, deadlines, competitors, and other unsupported fields blank.

Map q1 and c1 to the user's intention, q2 to the guidance question, s2 to the current report, and s1 to a reference for a proposed measure. Do not adopt c2 as evidence that guidance alone solves the problem. Do not transfer s1's completion rate or success into the user's achievements. Investigation, responses, and trials are future proposals, not completed actions. If the request is to organize the article itself, preserve its activities and do not mix in these new measures for the user.

You can link adopted q1, q2, s1, and s2 after verifying their project membership. Report what was actually registered. A measure comment might briefly say: Proposal; q2 and s1 inform the guidance option, but its effect in this project is unverified. Abstract sensitive private information rather than copying it into titles, body text, or node comments.

Do not use add a guide as an intermediate purpose, assume a 20% increase in adoption as an established win condition without evidence, or copy another company's budget and schedule into the user's factors. If the user asks for numerical suggestions, mark them as AI proposals and preserve unknown assumptions. Explain and discuss changes that would alter the user's intention.

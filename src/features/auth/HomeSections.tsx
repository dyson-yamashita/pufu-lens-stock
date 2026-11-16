import { Bookmark, BookOpen, CircleHelp, Lightbulb, Network, Plug, Users } from 'lucide-react';
import type { Language } from '../../../shared/locale';
import { manualPath } from '../../../shared/site-paths';
import { translateUi } from '../../i18n/i18n';

/** The same entry points and examples before and after the app loads. */
export default function HomeSections({ language }: { language: Language }) {
  const tr = (key: string) => translateUi(language, key);
  return (
    <>
      <section
        id="what-you-can-do"
        className="what-you-can-do"
        aria-labelledby="what-you-can-do-heading"
      >
        <h2 id="what-you-can-do-heading">{tr('ui.app.what_you_can_do')}</h2>
        <p className="home-section-intro">{tr('home.entry_intro')}</p>
        <div className="home-entry-list">
          {(
            [
              ['stock', Bookmark, 'stock'],
              ['grow', CircleHelp, 'question'],
              ['pufu', Network, 'pufu'],
            ] as const
          ).map(([entry, Icon, example]) => (
            <article className="what-you-can-do-item home-entry" key={entry}>
              <div className="home-card-icon" aria-hidden="true">
                <Icon size={23} />
              </div>
              <h3>{tr(`ui.app.step_${entry}_title`)}</h3>
              <p>{tr(`ui.app.step_${entry}_body`)}</p>
              <div className="home-entry-example">
                <span>{tr('home.try')}</span>
                <p>{tr(`home.${example}_example`)}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="home-start-guide">{tr('home.get_started')}</p>
        <aside className="home-integration" aria-labelledby="home-integration-heading">
          <Plug size={24} aria-hidden="true" />
          <div>
            <h3 id="home-integration-heading">{tr('ui.app.step_mcp_title')}</h3>
            <p>{tr('ui.app.step_mcp_body')}</p>
          </div>
          <a className="text-link" href={`${manualPath(language)}#integrations`}>
            {tr('home.view_manual')}
          </a>
        </aside>
      </section>
      <section id="use-cases" className="what-you-can-do" aria-labelledby="use-cases-heading">
        <h2 id="use-cases-heading">{tr('ui.app.use_cases')}</h2>
        <div className="use-case-list">
          {(
            [
              ['learning', BookOpen],
              ['business', Lightbulb],
              ['sharing', Users],
            ] as const
          ).map(([useCase, Icon]) => (
            <article className="what-you-can-do-item" key={useCase}>
              <div className="what-you-can-do-heading">
                <Icon className="home-use-case-icon" size={23} aria-hidden="true" />
                <h3>{tr(`ui.app.use_case_${useCase}_title`)}</h3>
              </div>
              <p>{tr(`ui.app.use_case_${useCase}_body`)}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

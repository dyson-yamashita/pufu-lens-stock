import BrandLogo from './BrandLogo';
import { t, useLanguage, legalHref, homeHref, translateUi } from './i18n';
import { useEffect } from 'react';
import { ArrowUp, BookOpen } from 'lucide-react';
import type { Language } from '../shared/locale';
import LegalLinks from './LegalLinks';
import {
  supportPufuInstallCommand,
  deepenQuestionsInstallCommand,
  skillsSourceUrl,
} from '../shared/skills';
const sections = (tr: typeof t) => [
  {
    id: 'stocks',
    title: tr('ui.user_manual.save_articles_as_stocks'),
    content: (
      <div className="manual-guide">
        <ol>
          <li>{tr('ui.user_manual.open_save_article_and_choose_url_or_text')}</li>
          <li>{tr('ui.user_manual.choose_the_destination_project_enter_a_post_url_or')}</li>
          <li>{tr('ui.user_manual.open_the_added_card_to_view_its_summary_key')}</li>
        </ol>
        <p>{tr('manual.stock_detail_navigation')}</p>
        <div className="manual-topics">
          <details>
            <summary>{tr('first_steps.title')}</summary>
            <p>{tr('first_steps.manual')}</p>
          </details>
          <details>
            <summary>{tr('manual.stock_url_heading')}</summary>
            <p>{tr('manual.article_pages')}</p>
            <p>{tr('ui.user_manual.you_can_save_publicly_accessible_pdf_urls_pdfs_with')}</p>
            <p>{tr('manual.stock_x')}</p>
            <p>{tr('manual.stock_youtube_playback')}</p>
            <p>{tr('manual.stock_youtube_storage')}</p>
          </details>
          <details>
            <summary>{tr('manual.stock_images_heading')}</summary>
            <p>{tr('manual.stock_images_add')}</p>
            <p>{tr('manual.stock_images_view')}</p>
            <p>{tr('manual.stock_images_visibility')}</p>
            <p>{tr('manual.stock_images_mcp')}</p>
          </details>
          <details>
            <summary>{tr('manual.stock_edit_heading')}</summary>
            <p>{tr('ui.user_manual.to_add_a_note_or_a_title_for_text')}</p>
            <p>{tr('ui.user_manual.star_articles_you_want_to_revisit_use_note_destination')}</p>
            <p>{tr('ui.user_manual.to_change_a_title_press_the_pencil_beside_it')}</p>
            <p>{tr('manual.stock_note_visibility')}</p>
          </details>
          <details>
            <summary>{tr('manual.project_lists_heading')}</summary>
            <p>
              {tr('ui.user_manual.when_creating_a_project_or_under_settings_advanced_settings')}
            </p>
          </details>
          <details>
            <summary>{tr('manual.stock_delete_heading')}</summary>
            <p>{tr('ui.user_manual.to_delete_a_stock_open_other_actions_at_the')}</p>
            <p>{tr('ui.user_manual.to_delete_a_whole_project_open_project_deletion_at')}</p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'questions',
    title: tr('ui.user_manual.find_and_write_questions'),
    content: (
      <div className="manual-guide">
        <h3>{tr('manual.question_read_heading')}</h3>
        <p>{tr('ui.user_manual.use_questions_insights_or_all_questions_insights_to_view')}</p>
        <h3>{tr('manual.question_write_heading')}</h3>
        <p>{tr('ui.user_manual.use_add_question_or_insight_to_save_your_own')}</p>
        <p>{tr('first_steps.manual_question')}</p>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.question_edit_heading')}</summary>
            <p>{tr('manual.question_link_stocks')}</p>
            <p>{tr('manual.question_edit')}</p>
            <p>{tr('manual.question_note_visibility')}</p>
            <p>{tr('ui.user_manual.for_questions_you_added_yourself_unlink_the_stocks_and')}</p>
          </details>
          <details>
            <summary>{tr('manual.question_generation_heading')}</summary>
            <p>
              {tr(
                'ui.user_manual.to_stop_automatic_question_generation_turn_off_automatically_generate',
              )}
            </p>
          </details>
          <details>
            <summary>{tr('manual.question_delete_heading')}</summary>
            <p>{tr('ui.user_manual.to_delete_a_question_or_insight_open_other_actions')}</p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'pufu',
    title: tr('ui.user_manual.develop_solutions_with_pufu'),
    content: (
      <div className="manual-guide">
        <p>{tr('ui.user_manual.use_all_pufu_in_the_side_menu_or_the')}</p>
        <h3>{tr('manual.pufu_create_heading')}</h3>
        <ol>
          <li>{tr('ui.user_manual.choose_add_pufu_in_the_pufu_list_and_select')}</li>
          <li>{tr('ui.user_manual.write_your_desired_state_as_the_gaining_goal_optionally')}</li>
          <li>{tr('manual.pufu_progress')}</li>
        </ol>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.pufu_generation_heading')}</summary>
            <p>{tr('manual.pufu_sources')}</p>
            <p>{tr('manual.pufu_grounding')}</p>
            <p>{tr('manual.pufu_ai_usage')}</p>
            <p className="manual-note">{tr('manual.pufu_limit')}</p>
          </details>
          <details>
            <summary>{tr('manual.pufu_edit_heading')}</summary>
            <p>{tr('manual.pufu_titles')}</p>
            <p>{tr('ui.user_manual.press_the_pufu_image_to_enlarge_it_pinch_or')}</p>
            <p>{tr('ui.user_manual.press_edit_at_the_image_s_lower_right_change')}</p>
            <p>{tr('ui.user_manual.when_the_editor_is_narrow_tap_or_drag_its')}</p>
          </details>
          <details>
            <summary>{tr('manual.pufu_phase_heading')}</summary>
            <p>{tr('ui.user_manual.use_add_phase_to_move_to_the_next_stage')}</p>
          </details>
          <details>
            <summary>{tr('manual.pufu_json_heading')}</summary>
            <p>{tr('ui.user_manual.choose_download_then_json_or_image_png_to_download')}</p>
            <h3>{tr('manual.pufu_json_create_heading')}</h3>
            <p>{tr('manual.pufu_import')}</p>
            <h3>{tr('manual.pufu_json_edit_heading')}</h3>
            <p>{tr('manual.pufu_import_edit')}</p>
            <p className="manual-note">{tr('manual.pufu_import_limits')}</p>
          </details>
          <details>
            <summary>{tr('manual.pufu_organize_heading')}</summary>
            <p>{tr('ui.user_manual.use_the_star_button_in_a_list_or_details')}</p>
            <p>{tr('ui.user_manual.open_edit_related_questions_insights_and_stocks_on_a')}</p>
          </details>
          <details>
            <summary>{tr('manual.pufu_delete_heading')}</summary>
            <p>{tr('ui.user_manual.to_delete_a_pufu_open_other_actions')}</p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'comments',
    title: tr('ui.user_manual.record_your_thinking_with_comments'),
    content: (
      <div className="manual-guide">
        <p>{tr('ui.user_manual.use_the_comments_tab_in_stock_or_question_details')}</p>
        <p>{tr('ui.user_manual.enter_text_and_choose_add_comment_comments_show_their')}</p>
        <p className="manual-note">
          {tr('ui.user_manual.this_is_a_private_record_excluded_from_public_pages')}
        </p>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.comments_integration_heading')}</summary>
            <p>{tr('ui.user_manual.ai_integrations_such_as_chatgpt_connected_as_the_same')}</p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'memory',
    title: tr('ui.user_manual.review_interests_and_knowledge_in_memory'),
    content: (
      <div className="manual-guide">
        <p>
          {tr(
            'ui.user_manual.as_article_summaries_accumulate_memory_collects_your_interest_patterns',
          )}
        </p>
        <p>{tr('ui.user_manual.use_source_articles_beside_a_knowledge_item_to_view')}</p>
        <div className="manual-topics">
          <details>
            <summary>{tr('ui.memory_history.title')}</summary>
            <p>{tr('manual.memory_history')}</p>
            <p>{tr('manual.memory_history_storage')}</p>
          </details>
          <details>
            <summary>{tr('manual.memory_sources_heading')}</summary>
            <p>{tr('ui.user_manual.youtube_contributes_to_memory_only_when_you_write_a')}</p>
            <p className="manual-note">
              {tr('ui.user_manual.to_exclude_a_project_from_your_user_memory_turn')}
            </p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'sharing',
    title: tr('ui.public_projects.publish_a_project'),
    content: (
      <div className="manual-guide">
        <ol>
          <li>{tr('ui.user_manual.open_settings_for_the_project_you_want_to_share')}</li>
          <li>
            {tr(
              'ui.user_manual.in_publication_settings_enable_publishing_enter_a_public_introduction',
            )}
          </li>
          <li>
            {tr(
              'ui.user_manual.under_before_publishing_review_personal_or_private_information_copyright',
            )}
          </li>
          <li>{tr('ui.user_manual.share_the_displayed_public_url_the_project_is_also')}</li>
        </ol>
        <p className="manual-note">
          {tr('ui.user_manual.memories_private_notes_comments_in_details_retrieved_article_text')}
        </p>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.sharing_view_heading')}</summary>
            <p>{tr('ui.user_manual.public_pages_can_be_viewed_without_signing_in_and')}</p>
          </details>
          <details>
            <summary>{tr('manual.sharing_search_heading')}</summary>
            <p>{tr('ui.user_manual.public_search_indexing')}</p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'integrations',
    title: tr('ui.user_manual.use_other_apps'),
    content: (
      <div className="manual-guide">
        <p>{tr('manual.integrations_intro')}</p>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.integration_connect_heading')}</summary>
            <p>{tr('ui.user_manual.register_the_url_under_integrations_mcp_integration_in_the')}</p>
            <p>{tr('ui.user_manual.edit_mcp_connection')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_project_heading')}</summary>
            <p>{tr('ui.user_manual.if_an_integration_needs_a_project_id_open_that')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_memory_heading')}</summary>
            <p>{tr('manual.mcp_project_memory')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_pufu_create_heading')}</summary>
            <p>{tr('ui.user_manual.allow_create_edit_pufu_in_your_mcp_connection_to')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_pufu_view_heading')}</summary>
            <p>{tr('ui.user_manual.choose_a_pufu_from_the_list_or_question_details')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_search_heading')}</summary>
            <p>{tr('ui.user_manual.search_uses_keywords_by_default_to_also_find_similar')}</p>
          </details>
          <details>
            <summary>{tr('manual.integration_iphone_heading')}</summary>
            <p>
              {tr('ui.user_manual.create_a_token_under_shortcut_integration_then_configure_the')}
            </p>
          </details>
          <details>
            <summary>{tr('manual.integration_disconnect_heading')}</summary>
            <p>
              {tr(
                'ui.user_manual.disconnect_a_service_under_integrations_connected_services_open_x',
              )}
            </p>
          </details>
        </div>
      </div>
    ),
  },
  {
    id: 'skills',
    title: tr('skills.manual_title'),
    content: (
      <div className="manual-guide">
        <p>{tr('manual.skills_intro')}</p>
        <div className="manual-topics">
          <details>
            <summary>{tr('manual.skills_install_heading')}</summary>
            <ol>
              <li>{tr('skills.prerequisites')}</li>
              <li>
                {tr('skills.install_step')}
                <p>{tr('skills.deepen_questions')}</p>
                <pre className="skill-command">
                  <code>{deepenQuestionsInstallCommand}</code>
                </pre>
                <p>{tr('skills.support_pufu')}</p>
                <pre className="skill-command">
                  <code>{supportPufuInstallCommand}</code>
                </pre>
              </li>
              <li>{tr('skills.connect_step')}</li>
            </ol>
          </details>
          <details>
            <summary>{tr('skills.deepen_questions')}</summary>
            <p>{tr('skills.description')}</p>
            <p>{tr('skills.use_step')}</p>
          </details>
          <details>
            <summary>{tr('skills.support_pufu')}</summary>
            <p>{tr('skills.support_use_step')}</p>
          </details>
          <details>
            <summary>{tr('manual.skills_cost_heading')}</summary>
            <p>{tr('skills.cost')}</p>
          </details>
          <details>
            <summary>{tr('manual.skills_update_heading')}</summary>
            <p>{tr('skills.update')}</p>
            <pre className="skill-command">
              <code>npx skills update deepen-questions</code>
            </pre>
            <pre className="skill-command">
              <code>npx skills update support-pufu</code>
            </pre>
          </details>
        </div>
        <p className="manual-note">{tr('skills.privacy')}</p>
        <p>
          <a href={skillsSourceUrl} target="_blank" rel="noreferrer">
            {tr('skills.source_link')}
          </a>
        </p>
      </div>
    ),
  },
  {
    id: 'withdrawal',
    title: tr('ui.profile.delete_your_account'),
    content: (
      <>
        <ol>
          <li>{tr('ui.user_manual.open_profile_from_the_side_menu')}</li>
          <li>{tr('ui.user_manual.open_how_do_i_delete_my_account_to_show')}</li>
          <li>{tr('ui.user_manual.press_delete_account_and_review_the_data_to_be')}</li>
          <li>{tr('ui.user_manual.confirm_with_delete_all_data_and_account')}</li>
        </ol>
        <p className="manual-note">
          {tr('ui.user_manual.registered_data_and_saved_article_bodies_are_deleted_and')}
        </p>
      </>
    ),
  },
  {
    id: 'help',
    title: tr('ui.user_manual.troubleshooting'),
    content: (
      <div className="manual-guide">
        <div className="manual-topics">
          <details>
            <summary>{tr('ui.user_manual.article_retrieval_failed')}</summary>
            <p>{tr('ui.user_manual.open_the_stock_details_and_use_retry_retrieval_under')}</p>
          </details>
          <details>
            <summary>{tr('ui.user_manual.a_summary_or_pufu_has_not_appeared_yet')}</summary>
            <p>{tr('ui.user_manual.processing_after_a_save_can_take_time_check_the')}</p>
          </details>
        </div>
      </div>
    ),
  },
];
export default function UserManual({ language: forced }: { language?: Language }) {
  const current = useLanguage();
  const language = forced ?? current.language;
  const tr = (key: string, values?: Record<string, string | number>) =>
    translateUi(language, key, values);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = tr('ui.user_manual.user_manual_pufu_lens');
    // Reactの描画後にも、直リンクで指定された節を表示する。
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView?.();
    return () => {
      document.title = previousTitle;
    };
  }, [language]);
  const home = homeHref(language);
  return (
    <div className="public-page manual-page" lang={language}>
      <header className="public-header">
        <a href={home} className="brand">
          <BrandLogo />
        </a>
        <a href={home} className="text-link">
          {tr('ui.user_manual.back_to_home')}
        </a>
      </header>
      <main className="manual-main">
        <header className="page-header" id="manual-start" tabIndex={-1}>
          <div>
            <h1>{tr('ui.app.user_manual')}</h1>
            <p>
              {tr('ui.user_manual.a_basic_guide_to_collecting_articles_developing_questions_and')}
            </p>
            <nav className="legal-links" aria-label={tr('language.label')}>
              <a href="/manual" lang="ja" aria-current={language === 'ja' ? 'page' : undefined}>
                日本語
              </a>
              <a href="/en/manual" lang="en" aria-current={language === 'en' ? 'page' : undefined}>
                English
              </a>
            </nav>
          </div>
        </header>
        <section className="manual-start" aria-labelledby="manual-start-heading">
          <h2 id="manual-start-heading">
            <BookOpen size={20} aria-hidden="true" />
            {tr('ui.user_manual.start_here')}
          </h2>
          <ol>
            <li>
              {tr('manual.language.start')}{' '}
              <a href={legalHref('terms', language)}>{tr('ui.legal_links.terms_of_service')}</a>
              {tr('ui.user_manual.and')}
              <a href={legalHref('privacy', language)}>{tr('ui.legal_links.privacy_policy')}</a>
              {tr('ui.user_manual.review_both_documents_check_both_consent_boxes_and_press')}
            </li>
            <li>{tr('manual.language.profile')}</li>
            <li>{tr('ui.user_manual.save_interesting_article_urls_or_your_own_text_as')}</li>
            <li>{tr('ui.user_manual.choose_a_question_and_explore_solutions_with_pufu')}</li>
          </ol>
          <div className="manual-topics">
            <details>
              <summary>{tr('manual.language_heading')}</summary>
              <p>{tr('manual.language.future')}</p>
            </details>
            <details>
              <summary>{tr('ui.theme_settings.display_settings')}</summary>
              <p>{tr('manual.theme')}</p>
            </details>
            <details>
              <summary>{tr('ui.usage.title')}</summary>
              <p>{tr('manual.usage')}</p>
            </details>
          </div>
        </section>
        <nav className="manual-toc" aria-label={tr('ui.user_manual.manual_contents')}>
          {sections(tr).map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
        {sections(tr).map((section) => (
          <section
            className="manual-section"
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            tabIndex={-1}
          >
            <h2 id={`${section.id}-heading`}>{section.title}</h2>
            {section.content}
          </section>
        ))}
        <a className="text-link manual-back-top" href="#manual-start">
          <ArrowUp size={16} aria-hidden="true" />
          {tr('ui.user_manual.back_to_top')}
        </a>
        <LegalLinks language={language} />
      </main>
    </div>
  );
}

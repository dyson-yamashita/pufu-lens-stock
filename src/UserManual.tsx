import { t, useLanguage, legalHref } from './i18n';
import { useEffect } from 'react';
import { ArrowUp, BookOpen } from 'lucide-react';
import LegalLinks from './LegalLinks';
const sections = () => [
  {
    id: 'stocks',
    title: t('ui.user_manual.save_articles_as_stocks'),
    content: (
      <>
        <ol>
          <li>{t('ui.user_manual.open_save_article_and_choose_url_or_text')}</li>
          <li>{t('ui.user_manual.choose_the_destination_project_enter_a_post_url_or')}</li>
          <li>{t('ui.user_manual.open_the_added_card_to_view_its_summary_key')}</li>
        </ol>
        <p>{t('ui.user_manual.to_add_a_note_or_a_title_for_text')}</p>
        <p>{t('ui.user_manual.you_can_save_publicly_accessible_pdf_urls_pdfs_with')}</p>
        <p>{t('ui.user_manual.star_articles_you_want_to_revisit_use_note_destination')}</p>
        <p>{t('ui.user_manual.short_text_is_shown_as_originally_written_without_expanding')}</p>
        <p>{t('ui.user_manual.when_creating_a_project_or_under_settings_advanced_settings')}</p>
        <p>{t('ui.user_manual.to_change_a_title_press_the_pencil_beside_it')}</p>
        <p>{t('ui.user_manual.to_delete_a_stock_open_other_actions_at_the')}</p>
        <p>{t('ui.user_manual.to_delete_a_whole_project_open_project_deletion_at')}</p>
        <p className="manual-note">
          {t('ui.user_manual.x_posts_require_x_api_configuration_in_integrations_youtube')}
        </p>
      </>
    ),
  },
  {
    id: 'questions',
    title: t('ui.user_manual.find_and_write_questions'),
    content: (
      <>
        <p>{t('ui.user_manual.use_questions_insights_or_all_questions_insights_to_view')}</p>
        <p>{t('ui.user_manual.use_add_question_or_insight_to_save_your_own')}</p>
        <p>{t('ui.user_manual.in_details_switch_between_content_pufu_comments_and_note')}</p>
        <p>{t('ui.user_manual.for_questions_you_added_yourself_unlink_the_stocks_and')}</p>
        <p>
          {t(
            'ui.user_manual.to_stop_automatic_question_generation_turn_off_automatically_generate',
          )}
        </p>
        <p>{t('ui.user_manual.to_delete_a_question_or_insight_open_other_actions')}</p>
      </>
    ),
  },
  {
    id: 'pufu',
    title: t('ui.user_manual.develop_solutions_with_pufu'),
    content: (
      <>
        <p>{t('ui.user_manual.use_all_pufu_in_the_side_menu_or_the')}</p>
        <p>{t('manual.pufu_titles')}</p>
        <p>{t('ui.user_manual.use_the_star_button_in_a_list_or_details')}</p>
        <ol>
          <li>{t('ui.user_manual.choose_add_pufu_in_the_pufu_list_and_select')}</li>
          <li>{t('ui.user_manual.write_your_desired_state_as_the_gaining_goal_optionally')}</li>
          <li>{t('ui.user_manual.press_the_pufu_image_to_enlarge_it_pinch_or')}</li>
          <li>{t('ui.user_manual.press_edit_at_the_image_s_lower_right_change')}</li>
          <li>{t('ui.user_manual.use_add_phase_to_move_to_the_next_stage')}</li>
          <li>{t('ui.user_manual.choose_download_then_json_or_image_png_to_download')}</li>
          <li>{t('ui.user_manual.when_the_editor_is_narrow_tap_or_drag_its')}</li>
        </ol>
        <p>{t('ui.user_manual.open_edit_related_questions_insights_and_stocks_on_a')}</p>
        <p>{t('ui.user_manual.to_delete_a_pufu_open_other_actions')}</p>
      </>
    ),
  },
  {
    id: 'comments',
    title: t('ui.user_manual.record_your_thinking_with_comments'),
    content: (
      <>
        <p>{t('ui.user_manual.use_the_comments_tab_in_stock_or_question_details')}</p>
        <p>{t('ui.user_manual.enter_text_and_choose_add_comment_comments_show_their')}</p>
        <p>{t('ui.user_manual.ai_integrations_such_as_chatgpt_connected_as_the_same')}</p>
        <p className="manual-note">
          {t('ui.user_manual.this_is_a_private_record_excluded_from_public_pages')}
        </p>
      </>
    ),
  },
  {
    id: 'memory',
    title: t('ui.user_manual.review_interests_and_knowledge_in_memory'),
    content: (
      <>
        <p>
          {t(
            'ui.user_manual.as_article_summaries_accumulate_memory_collects_your_interest_patterns',
          )}
        </p>
        <p>{t('ui.user_manual.use_source_articles_beside_a_knowledge_item_to_view')}</p>
        <p>{t('ui.user_manual.youtube_contributes_to_memory_only_when_you_write_a')}</p>
        <p className="manual-note">
          {t('ui.user_manual.to_exclude_a_project_from_your_user_memory_turn')}
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: t('ui.public_projects.publish_a_project'),
    content: (
      <>
        <ol>
          <li>{t('ui.user_manual.open_settings_for_the_project_you_want_to_share')}</li>
          <li>
            {t(
              'ui.user_manual.in_publication_settings_enable_publishing_enter_a_public_introduction',
            )}
          </li>
          <li>
            {t(
              'ui.user_manual.under_before_publishing_review_personal_or_private_information_copyright',
            )}
          </li>
          <li>{t('ui.user_manual.share_the_displayed_public_url_the_project_is_also')}</li>
        </ol>
        <p>{t('ui.user_manual.public_pages_can_be_viewed_without_signing_in_and')}</p>
        <p className="manual-note">
          {t('ui.user_manual.memories_private_notes_comments_in_details_retrieved_article_text')}
        </p>
      </>
    ),
  },
  {
    id: 'integrations',
    title: t('ui.user_manual.use_other_apps'),
    content: (
      <ul>
        <li>
          <strong>{t('ui.user_manual.iphone_share_menu')}</strong>
          {t('ui.user_manual.create_a_token_under_shortcut_integration_then_configure_the')}
        </li>
        <li>
          <strong>{t('ui.user_manual.find_a_project_id')}</strong>
          {t('ui.user_manual.if_an_integration_needs_a_project_id_open_that')}
        </li>
        <li>
          <strong>{t('ui.user_manual.connect_chatgpt_and_other_apps')}</strong>
          {t('ui.user_manual.register_the_url_under_integrations_mcp_integration_in_the')}
        </li>
        <li>{t('ui.user_manual.edit_mcp_connection')}</li>
        <li>
          <strong>{t('ui.user_manual.create_and_edit_pufu_in_chatgpt_and_other_apps')}</strong>
          {t('ui.user_manual.allow_create_edit_pufu_in_your_mcp_connection_to')}
        </li>
        <li>
          <strong>{t('ui.user_manual.find_related_stocks_with_mcp')}</strong>
          {t('ui.user_manual.search_uses_keywords_by_default_to_also_find_similar')}
        </li>
        <li>
          <strong>{t('ui.user_manual.view_pufu_in_chatgpt_and_other_apps')}</strong>
          {t('ui.user_manual.choose_a_pufu_from_the_list_or_question_details')}
        </li>
        <li>
          <strong>{t('ui.user_manual.disconnect')}</strong>
          {t('ui.user_manual.disconnect_a_service_under_integrations_connected_services_open_x')}
        </li>
      </ul>
    ),
  },
  {
    id: 'withdrawal',
    title: t('ui.profile.delete_your_account'),
    content: (
      <>
        <ol>
          <li>{t('ui.user_manual.open_profile_from_the_side_menu')}</li>
          <li>{t('ui.user_manual.open_how_do_i_delete_my_account_to_show')}</li>
          <li>{t('ui.user_manual.press_delete_account_and_review_the_data_to_be')}</li>
          <li>{t('ui.user_manual.confirm_with_delete_all_data_and_account')}</li>
        </ol>
        <p className="manual-note">
          {t('ui.user_manual.registered_data_and_saved_article_bodies_are_deleted_and')}
        </p>
      </>
    ),
  },
  {
    id: 'help',
    title: t('ui.user_manual.troubleshooting'),
    content: (
      <dl className="manual-help">
        <dt>{t('ui.user_manual.article_retrieval_failed')}</dt>
        <dd>{t('ui.user_manual.open_the_stock_details_and_use_retry_retrieval_under')}</dd>
        <dt>{t('ui.user_manual.a_summary_or_pufu_has_not_appeared_yet')}</dt>
        <dd>{t('ui.user_manual.processing_after_a_save_can_take_time_check_the')}</dd>
      </dl>
    ),
  },
];
export default function UserManual() {
  const { language } = useLanguage();
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('ui.user_manual.user_manual_pufu_lens');
    // Reactの描画後にも、直リンクで指定された節を表示する。
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView?.();
    return () => {
      document.title = previousTitle;
    };
  }, [language]);
  return (
    <div className="public-page manual-page">
      <header className="public-header">
        <a href="/" className="brand">
          <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
          <span>Pufu Lens</span>
        </a>
        <a href="/" className="text-link">
          {t('ui.user_manual.back_to_home')}
        </a>
      </header>
      <main className="manual-main">
        <header className="page-header" id="manual-start" tabIndex={-1}>
          <div>
            <h1>{t('ui.app.user_manual')}</h1>
            <p>
              {t('ui.user_manual.a_basic_guide_to_collecting_articles_developing_questions_and')}
            </p>
          </div>
        </header>
        <section className="manual-start" aria-labelledby="manual-start-heading">
          <h2 id="manual-start-heading">
            <BookOpen size={20} aria-hidden="true" />
            {t('ui.user_manual.start_here')}
          </h2>
          <ol>
            <li>
              {t('manual.language.start')}{' '}
              <a href={legalHref('terms')}>{t('ui.legal_links.terms_of_service')}</a>
              {t('ui.user_manual.and')}
              <a href={legalHref('privacy')}>{t('ui.legal_links.privacy_policy')}</a>
              {t('ui.user_manual.review_both_documents_check_both_consent_boxes_and_press')}
            </li>
            <li>{t('manual.language.profile')}</li>
            <li>{t('ui.user_manual.save_interesting_article_urls_or_your_own_text_as')}</li>
            <li>{t('ui.user_manual.choose_a_question_and_explore_solutions_with_pufu')}</li>
          </ol>
          <p className="manual-note">{t('manual.language.future')}</p>
        </section>
        <nav className="manual-toc" aria-label={t('ui.user_manual.manual_contents')}>
          {sections().map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
        {sections().map((section) => (
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
          {t('ui.user_manual.back_to_top')}
        </a>
        <LegalLinks />
      </main>
    </div>
  );
}

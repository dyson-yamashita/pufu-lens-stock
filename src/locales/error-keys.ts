// Only application-owned error messages are eligible for translation.
export const errorKeys: Record<string, string> = {
  'タイトルは200文字以内で入力してください。': 'pufu.title_too_long',
  'AIの出力形式が正しくありません。': 'error.the_ai_output_format_is_invalid',
  'AIの出力形式が正しくありません。再試行してください。':
    'error.the_ai_output_format_is_invalid_please_retry',
  'Workers AIが未設定です。CloudflareのAIバインディングを設定してください。':
    'error.workers_ai_is_not_configured_ask_the_administrator_to_configure',
  'JSON形式で送信してください。': 'error.send_the_request_as_json',
  '入力内容を確認してください。文字数または形式が正しくありません。':
    'error.check_your_input_the_length_or_format_is_incorrect',
  'プロジェクトが見つかりません。': 'error.project_not_found',
  'ニックネームの登録と利用規約・プライバシーポリシーへの同意を完了してください。':
    'error.complete_nickname_registration_and_consent_to_the_terms_of_service',
  'このトークンには操作の権限がありません。':
    'error.this_token_does_not_have_permission_for_this_operation',
  'コメントの対象と局面番号を確認してください。': 'error.check_the_comment_target_and_phase_number',
  'ログインが必要です。': 'error.sign_in_is_required',
  'プロジェクトは50件まで作成できます。': 'error.you_can_create_up_to_50_projects',
  '取得件数・並び順・表示形式・検索方式を確認してください。':
    'error.check_the_limit_sort_order_display_format_and_search_mode',
  'このトークンの保存先プロジェクトとは異なります。':
    'error.this_differs_from_the_token_s_destination_project',
  'Idempotency-Keyは128文字以内の英数字・ハイフン・アンダースコアで指定してください。':
    'error.use_up_to_128_letters_numbers_hyphens_or_underscores_for',
  '同じIdempotency-Keyで異なる内容が送信されました。':
    'error.different_content_was_sent_with_the_same_idempotency_key',
  'この保存は削除済みです。新しいIdempotency-Keyで送信してください。':
    'error.this_saved_item_has_been_deleted_use_a_new_idempotency',
  '保存先のプロジェクトを作成してください。': 'error.create_a_destination_project',
  '根拠の記事は削除済み、または見つかりません。':
    'error.the_source_article_has_been_deleted_or_cannot_be_found',
  '記事が見つかりません。': 'error.article_not_found',
  '問い・気づきが見つかりません。': 'error.question_or_insight_not_found',
  'プ譜が見つかりません。': 'error.pufu_not_found',
  '記事に紐づく問い・気づきの保存先は、元の記事で変更してください。':
    'error.change_the_destination_of_an_article_linked_question_or_insight',
  '保存先を変更する前に、ストックの関連を解除してください。':
    'error.remove_stock_relations_before_changing_the_destination',
  '問い・気づきの保存先が変更されました。再読み込みしてお試しください。':
    'error.the_question_or_insight_s_destination_changed_reload_and_try',
  'プ譜の生成が完了してから保存してください。':
    'error.wait_for_pufu_generation_to_finish_before_saving',
  '局面の追加は最新の局面から行ってください。': 'error.add_a_phase_from_the_latest_phase',
  '局面が見つかりません。': 'error.phase_not_found',
  '別の画面で更新されています。編集中の内容をJSONで保存し、開き直してください。':
    'error.updated_in_another_screen_save_your_edits_as_json_then',
  '別の画面で更新されています。再読み込みしてください。':
    'error.updated_in_another_screen_please_reload',
  '生成に失敗したプ譜だけ再試行できます。': 'error.only_pufu_with_failed_generation_can_be_retried',
  '同じリクエストIDで異なる問い・気づきが送信されました。':
    'error.different_questions_or_insights_were_sent_with_the_same_request',
  '紐づけるストックが見つかりません。': 'error.a_stock_to_link_could_not_be_found',
  'ストックとプロジェクトが一致しません。': 'error.the_stock_and_project_do_not_match',
  '生成に失敗した問い・気づきだけ再試行できます。':
    'error.only_questions_or_insights_with_failed_generation_can_be_retried',
  '先に記事の取得・要約を完了してください。':
    'error.complete_article_retrieval_and_summarization_first',
  '移動先には同じ記事が保存されています。': 'error.the_destination_already_has_the_same_article',
  '補完本文は1〜20,000文字で入力してください。':
    'error.enter_between_1_and_20_000_characters_of_replacement_text',
  '取得に失敗した記事だけ再試行できます。':
    'error.only_articles_with_failed_retrieval_can_be_retried',
  'リクエストIDの形式が正しくありません。': 'error.the_request_id_format_is_invalid',
  '同じリクエストIDで異なる保存先または更新方法が送信されました。':
    'error.different_destinations_or_update_methods_were_sent_with_the_same',
  '有効なトークンは20個までです。不要なトークンを失効してください。':
    'error.up_to_20_tokens_can_be_active_revoke_unused_tokens',
  'リクエストを確認してください。': 'error.check_the_request',
  'Google認証の設定が必要です。READMEの設定手順を確認してください。':
    'error.google_authentication_must_be_configured_consult_the_setup_instructions_in',
  'この操作はアプリの画面から実行してください。': 'error.perform_this_operation_from_the_app',
  'Bearerトークンを確認してください。': 'error.check_the_bearer_token',
  'トークンが無効、失効済み、または期限切れです。': 'error.the_token_is_invalid_revoked_or_expired',
  'コメントの対象が見つかりません。': 'error.comment_target_not_found',
  '同じリクエストIDで異なるコメントが送信されました。':
    'error.different_comments_were_sent_with_the_same_request_id',
  '本文を取得できませんでした。JavaScript対応のBrowser Runを設定するか、別の公開URLをお試しください。':
    'error.could_not_retrieve_the_article_text_configure_javascript_enabled_browser',
  '公開された本文を取得できませんでした。': 'error.could_not_retrieve_public_article_text',
  'ページが大きすぎます（上限2MB）。': 'error.the_page_is_too_large_2_mb_maximum',
  'リダイレクトが多すぎるか、移動先が無効です。':
    'error.too_many_redirects_or_an_invalid_destination',
  'リダイレクトを完了できませんでした。': 'error.could_not_complete_the_redirect',
  'Xの取得にはユーザー認証が必要です。':
    'error.user_authentication_is_required_to_retrieve_x_posts',
  '現在はHTML・テキスト・PDFの記事に対応しています。':
    'error.currently_html_text_and_pdf_articles_are_supported',
  '記事本文を十分に取得できませんでした。ログインやアクセス制限が必要な可能性があります。':
    'error.could_not_retrieve_enough_article_text_the_page_may_require',
  '本文が長すぎます（上限12万文字）。URLは保存されています。':
    'error.the_article_text_is_too_long_120_000_characters_maximum',
  'AI処理の待機期限（受付から30分）に達したため停止しました。再試行してください。':
    'error.ai_processing_stopped_after_waiting_30_minutes_from_acceptance_please',
  '認可画面を開いたアカウントで、接続をやり直してください。':
    'error.reconnect_using_the_account_that_opened_the_authorization_screen',
  '退会済みのアカウントでは連携できません。': 'error.a_deleted_account_cannot_connect_integrations',
  'このプロジェクトへのアクセスは許可されていません。':
    'error.access_to_this_project_is_not_permitted',
  '指定されたデータが見つかりません。': 'error.the_requested_data_was_not_found',
  'URLまたはテキストの入力内容を確認してください。': 'error.check_the_url_or_text_input',
  '問い・気づきに添える任意のメモ。省略時は空文字。':
    'error.an_optional_note_accompanying_the_question_or_insight_empty_when',
  'PDFが大きすぎます（上限10MB）。': 'error.the_pdf_is_too_large_10_mb_maximum',
  'PDFの解析が時間内に完了しませんでした。本文を補完して再試行してください。':
    'error.pdf_processing_timed_out_supply_the_article_text_and_retry',
  'PDFを読み取れませんでした。': 'error.could_not_read_the_pdf',
  'PDFの文字対応表を読み込めませんでした。': 'error.could_not_load_the_pdf_s_character_map',
  'PDFのページ数が多すぎます（上限100ページ）。': 'error.the_pdf_has_too_many_pages_100_maximum',
  'PDFの文字情報を十分に取得できませんでした。画像のみのPDFには対応していません。本文を補完して再試行してください。':
    'error.could_not_retrieve_enough_text_from_the_pdf_image_only',
  'PDFを読み取れませんでした。ファイルの破損やパスワード保護を確認するか、本文を補完して再試行してください。':
    'error.could_not_read_the_pdf_check_for_corruption_or_password',
  '公開されているページが見つかりません。': 'error.the_public_page_was_not_found',
  '公開設定の入力内容を確認してください。': 'error.check_the_publication_settings',
  '同じリクエストIDで異なる内容が送信されました。':
    'error.different_content_was_sent_with_the_same_request_id',
  '問い・気づきの生成が完了してから、プ譜を作成できます。':
    'error.wait_for_question_or_insight_generation_to_finish_before_creating',
  '保存先が変更されました。開き直してお試しください。':
    'error.the_destination_changed_reopen_and_try_again',
  'プ譜が更新されています。再取得してください。': 'error.the_pufu_has_changed_fetch_it_again',
  'プ譜の状態を確認できません。再取得してください。':
    'error.could_not_confirm_the_pufu_status_fetch_it_again',
  'プ譜が更新または削除されています。再取得してください。':
    'error.the_pufu_has_changed_or_been_deleted_fetch_it_again',
  '画像リンクが無効、期限切れ、または更新済みです。':
    'error.the_image_link_is_invalid_expired_or_outdated',
  '画像を取得できませんでした。しばらくしてから再試行してください。':
    'error.could_not_retrieve_the_image_wait_a_little_and_try',
  '送信内容が大きすぎます。': 'error.the_request_body_is_too_large',
  '同じリクエストIDで異なる局面追加が送信されました。':
    'error.different_phase_additions_were_sent_with_the_same_request_id',
  '最新の完成済みプ譜とrevisionを取得してから追加してください。':
    'error.fetch_the_latest_completed_pufu_and_its_revision_before_adding',
  'プ譜が保存上限（256KiB）を超えています。': 'error.the_pufu_exceeds_the_storage_limit_256_kib',
  '保存済みプ譜の形式が正しくないため局面を追加できません。':
    'error.cannot_add_a_phase_because_the_saved_pufu_format_is',
  '別の画面で更新されています。最新のプ譜を取得してください。':
    'error.updated_in_another_screen_fetch_the_latest_pufu',
  'pufu_idまたはquestion_idを指定してください。': 'error.specify_pufu_id_or_question_id',
  'プ譜の作成が完了していません。問い・気づきの詳細で処理状態を確認してください。':
    'error.pufu_creation_is_not_complete_check_its_processing_status_in',
  'プ譜が取得上限（256KiB）を超えています。': 'error.the_pufu_exceeds_the_retrieval_limit_256_kib',
  '保存済みプ譜の形式が正しくないため取得できません。':
    'error.cannot_retrieve_the_saved_pufu_because_its_format_is_invalid',
  '画像生成用の静的アセットが設定されていません。':
    'error.static_assets_for_image_generation_are_not_configured',
  '画像用フォントを取得できません。': 'error.could_not_load_the_image_font',
  '画像生成モジュールを起動できません。': 'error.could_not_start_the_image_generation_module',
  '同じリクエストIDで異なるプ譜が送信されました。':
    'error.different_pufu_were_sent_with_the_same_request_id',
  '紐付け先の問い・気づきが見つかりません。': 'error.the_question_or_insight_to_link_was_not_found',
  '保存先が変更されました。再取得してください。': 'error.the_destination_changed_fetch_it_again',
  'Workers AIが未設定です。': 'error.workers_ai_is_not_configured',
  '紐づける問い・気づき、またはストックが見つかりません。':
    'error.a_question_insight_or_stock_to_link_could_not_be',
  'question_idとquestion_idsは同時に指定できません。':
    'error.question_id_and_question_ids_cannot_both_be_specified',
  '有効な記事URLを入力してください。': 'error.enter_a_valid_article_url',
  '公開されているHTTP(S)の記事URLを指定してください。':
    'error.specify_a_publicly_accessible_http_s_article_url',
  'URLの接続先を確認できませんでした。': 'error.could_not_verify_the_url_destination',
  '公開ネットワーク以外へのアクセスはできません。':
    'error.access_outside_public_networks_is_not_allowed',
  'AI処理の応答を確認できませんでした。重複生成を防ぐため停止しました。再試行してください。':
    'error.could_not_confirm_the_ai_response_processing_stopped_to_avoid',
  'AI処理の再試行上限に達しました。': 'error.the_ai_retry_limit_has_been_reached',
  '保存したテキスト本文が見つかりません。': 'error.saved_text_content_was_not_found',
  '保存した本文が見つかりません。': 'error.saved_article_text_was_not_found',
  '記事の処理に失敗しました。再試行してください。': 'error.article_processing_failed_please_retry',
  '外部連携の暗号化キーを管理者が設定する必要があります。':
    'error.the_administrator_must_configure_the_integration_encryption_key',
  '外部連携でXのBearer Tokenを登録するか、投稿本文を貼り付けて補完してください。':
    'error.register_an_x_bearer_token_in_integrations_or_paste_the',
  'Xの認証情報を読み出せません。外部連携の設定を確認してください。':
    'error.could_not_read_x_credentials_check_the_integration_settings',
  'Xの本文を取得できませんでした。時間をおくか、投稿本文を貼り付けて補完してください。':
    'error.could_not_retrieve_the_x_post_try_later_or_paste',
  'プ譜には局面番号を指定してください。ストック・問い・気づきには指定できません。':
    'error.specify_a_phase_number_for_pufu_only_not_for_stocks',
  'URLを入力してください。': 'error.enter_a_url',
  '本文を入力してください。': 'error.enter_the_article_text',
  '本文は20,000文字以内で入力してください。':
    'error.keep_the_article_text_within_20_000_characters',
  '問い・気づきを入力してください。': 'error.enter_a_question_or_insight',
  '問い・気づきは500文字以内で入力してください。':
    'error.keep_the_question_or_insight_within_500_characters',
  'プロジェクトを選択してください。': 'error.select_a_project',
  'メモは2,000文字以内で入力してください。': 'error.keep_the_note_within_2_000_characters',
  'stock_idとstock_idsは同時に指定できません。':
    'error.stock_id_and_stock_ids_cannot_both_be_specified',
  '1つの要点を1〜3文、全体で80〜120文字程度を目安に簡潔にまとめる。':
    'error.summarize_each_key_point_concisely_in_1_3_sentences_around',
  '名前を入力してください。': 'error.enter_a_name',
  '名前は80文字以内で入力してください。': 'error.keep_the_name_within_80_characters',
  '自己紹介は1,000文字以内で入力してください。': 'error.keep_the_bio_within_1_000_characters',
  '課題を入力してください。': 'error.enter_a_task',
  '課題は1,000文字以内で入力してください。': 'error.keep_the_task_within_1_000_characters',
  '補足は4,000文字以内で入力してください。':
    'error.keep_additional_context_within_4_000_characters',
  '見つかりません。': 'error.not_found',
  '複数のデータと関連しているため移動できません。関連を解除してから移動してください。':
    'error.this_item_is_linked_to_multiple_items_remove_the_relations',
  '直近24時間の保存上限（200件）に達しました。ストックを削除しても利用件数は減りません。':
    'error.you_have_reached_the_save_limit_of_200_items_in',
  'AI処理の利用上限または同時処理数に達しました。処理中の完了を待つか、再試行時刻以降にお試しください。':
    'error.the_ai_usage_or_concurrency_limit_has_been_reached_wait',
  '処理に失敗しました。時間をおいて再度お試しください。':
    'error.the_operation_failed_wait_a_little_and_try_again',
  'YouTubeの動画情報・字幕は取得しません。メモを記入するとメモリに反映されます。':
    'error.youtube_metadata_and_captions_are_not_retrieved_your_note_is',
  '生成言語が変更されたため、全件更新が必要です。':
    'error.the_generation_language_changed_rebuild_memory_from_all_articles',
  '以前のメモリの反映履歴がないため、全件更新が必要です。':
    'error.the_previous_memory_has_no_coverage_history_rebuild_it_from',
  '全件更新の要求を受け付けています。': 'error.a_full_memory_rebuild_has_been_requested',
  '自己紹介やプロジェクト情報が変更されたため、全件更新が必要です。':
    'error.your_bio_or_project_information_changed_rebuild_memory_from_all',
  '反映済みの記事が削除・移動・変更されたため、全件更新が必要です。':
    'error.an_included_article_was_deleted_moved_or_changed_rebuild_memory',
  'YouTubeのコンテンツは記録できません。URLのみストックに残します。':
    'error.youtube_content_cannot_be_recorded_only_its_url_remains_in',
};

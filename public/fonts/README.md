# 日本語フォント

Noto Sans CJK JP Regular、Version 2.004です。元データはLinuxのfonts-noto-cjkパッケージのNotoSansCJK-Regular.ttc、日本語の先頭faceです。対応Unicode cmapは削らず、日本語・ラテン文字向け以外のレイアウト機能とhintingを落としたOTFを同梱しています。

- 元プロジェクト: https://github.com/notofonts/noto-cjk
- 元ファイルSHA-256: `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`
- 同梱OTF SHA-256: `8e13bc91871133f81900fe60667276d99754b49be20ca660a3368cb220fbbea8`
- ライセンスと著作権: [OFL.txt](OFL.txt)。フォントはSIL Open Font License 1.1、記載のDebianパッケージングのライセンスはフォント本体に適用しません。

`packages/pufu-image/src/font-metrics.json` は同じOTFのcmap/hmtxから作った字幅情報です。1000 unitsでないグリフだけを収録します。画像の日本語を維持するため、アプリ本体と一緒にこの静的アセットを反映します。

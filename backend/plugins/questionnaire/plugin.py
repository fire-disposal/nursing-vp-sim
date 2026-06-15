from plugins.base import Plugin, UIManifest


class QuestionnairePlugin(Plugin):
    id = "questionnaire"
    name = "问卷"
    description = "训练前后问卷"

    def ui_manifest(self) -> UIManifest:
        return UIManifest(type="overlay", tab=None)

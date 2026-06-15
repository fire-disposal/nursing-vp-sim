from plugins.base import Plugin, UIManifest


class NursingRecordPlugin(Plugin):
    id = "nursing-record"
    name = "护理记录"
    description = "结构化护理记录单"

    def ui_manifest(self) -> UIManifest:
        return UIManifest(type="panel", tab={"icon": "ClipboardList", "label": "护理记录", "priority": 2})

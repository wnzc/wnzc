import sys
import json
import os
from datetime import datetime
from PyQt6.QtWidgets import (
    QApplication, QWidget, QLabel, QPushButton, QVBoxLayout,
    QHBoxLayout, QCheckBox, QSpinBox, QColorDialog, QFontComboBox,
    QComboBox, QSystemTrayIcon, QMenu, QDialog
)
from PyQt6.QtGui import QFont, QColor, QPainter, QIcon, QPixmap
from PyQt6.QtCore import Qt, QTimer

# 配置文件路径
CONFIG_PATH = os.path.join(os.path.expanduser("~"), "float_clock_config.json")
# 这里设置你的logo图片路径，自己改文件名即可
LOGO_PATH = "clock_logo.ico"

# 主悬浮时钟
class FloatClock(QWidget):
    def __init__(self):
        super().__init__()
        self.load_config()
        self.init_ui()
        self.init_tray()
        self.apply_style()
        self.start_timer()

    def load_config(self):
        default = {
            "x": 100, "y": 100,
            "font_size": 48,
            "font_family": "Microsoft YaHei" if sys.platform == "win32" else "PingFang SC",
            "color": "#ffffff",
            "shadow": True,
            "shadow_color": "#666666",
            "shadow_radius": 8,
            "stroke": True,
            "stroke_color": "#000000",
            "stroke_width": 2,
            "topmost": True,
            "mouse_pass": False,
            "time_format": 24
        }
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    self.config = json.load(f)
            except:
                self.config = default
        else:
            self.config = default

    def save_config(self):
        self.config["x"] = self.x()
        self.config["y"] = self.y()
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)

    def init_ui(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            (Qt.WindowType.WindowStaysOnTopHint if self.config["topmost"] else Qt.WindowType.Widget)
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground)

        self.time_label = QLabel()
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.setting_btn = QPushButton("设置")
        self.setting_btn.setVisible(False)
        self.setting_btn.clicked.connect(self.open_setting)

        layout = QVBoxLayout()
        layout.addWidget(self.time_label)
        layout.addWidget(self.setting_btn, alignment=Qt.AlignmentFlag.AlignCenter)
        self.setLayout(layout)

        self.setStyleSheet("background:transparent;")
        self.move(self.config["x"], self.config["y"])
        self.adjust_size()

    def init_tray(self):
        self.tray = QSystemTrayIcon(self)
        # 加载自定义logo
        if os.path.exists(LOGO_PATH):
            self.tray.setIcon(QIcon(LOGO_PATH))
        else:
            self.tray.setIcon(self.style().standardIcon(self.style().StandardPixmap.SP_ComputerIcon))
        self.tray.setVisible(True)
        
        menu = QMenu()
        setting_act = menu.addAction("设置")
        quit_act = menu.addAction("关闭")
        setting_act.triggered.connect(self.open_setting)
        quit_act.triggered.connect(self.quit_app)
        self.tray.setContextMenu(menu)

    def apply_style(self):
        font = QFont(self.config["font_family"], self.config["font_size"])
        self.time_label.setFont(font)
        self.update_time()
        self.adjust_size()

    def start_timer(self):
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_time)
        self.timer.start(1000)

    def update_time(self):
        now = datetime.now()
        fmt = "%H:%M:%S" if self.config["time_format"] == 24 else "%I:%M:%S %p"
        text = now.strftime(fmt)
        self.time_label.setText(text)

    def adjust_size(self):
        self.time_label.adjustSize()
        self.adjustSize()

    def paintEvent(self, e):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.fillRect(self.rect(), QColor(0, 0, 0, 0))

    def mousePressEvent(self, e):
        if self.config["mouse_pass"]: return
        if e.button() == Qt.MouseButton.LeftButton:
            self.drag_pos = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if self.config["mouse_pass"]: return
        if e.buttons() & Qt.MouseButton.LeftButton:
            self.move(e.globalPosition().toPoint() - self.drag_pos)

    def enterEvent(self, e):
        if not self.config["mouse_pass"]:
            self.setting_btn.setVisible(True)

    def leaveEvent(self, e):
        self.setting_btn.setVisible(False)

    def open_setting(self):
        d = SettingDialog(self)
        d.exec()

    def quit_app(self):
        self.save_config()
        sys.exit()

# 设置窗口
class SettingDialog(QDialog):
    def __init__(self, parent):
        super().__init__()
        self.parent = parent
        self.setWindowTitle("悬浮时钟设置")
        self.setFixedSize(580, 680)
        self.is_init = True
        self.build_ui()
        self.load_current_config()
        self.is_init = False

    def load_current_config(self):
        c = self.parent.config
        idx = self.font_box.findText(c["font_family"])
        if idx >= 0:
            self.font_box.setCurrentIndex(idx)
        self.size_spin.setValue(c["font_size"])
        self.color_btn.setStyleSheet(f"background-color: {c['color']};")
        self.time_combo.setCurrentText("24小时制" if c["time_format"] == 24 else "12小时制")
        self.top_check.setChecked(c["topmost"])
        self.pass_check.setChecked(c["mouse_pass"])
        self.shadow_check.setChecked(c["shadow"])
        self.stroke_check.setChecked(c["stroke"])
        self.shadow_color_btn.setStyleSheet(f"background-color: {c['shadow_color']};")
        self.shadow_spin.setValue(c["shadow_radius"])
        self.stroke_color_btn.setStyleSheet(f"background-color: {c['stroke_color']};")
        self.stroke_spin.setValue(c["stroke_width"])
        self.update_preview()

    def build_ui(self):
        layout = QVBoxLayout()
        self.preview = QLabel("实时预览")
        self.preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview.setMinimumHeight(120)
        layout.addWidget(self.preview)

        def row(label, widget):
            h = QHBoxLayout()
            h.addWidget(QLabel(label))
            h.addWidget(widget)
            return h

        self.font_box = QFontComboBox()
        layout.addLayout(row("字体：", self.font_box))
        self.size_spin = QSpinBox()
        self.size_spin.setRange(1, 10000)
        layout.addLayout(row("文字大小：", self.size_spin))
        self.color_btn = QPushButton("选择文字颜色")
        self.color_btn.clicked.connect(self.choose_color)
        layout.addLayout(row("文字颜色：", self.color_btn))
        self.time_combo = QComboBox()
        self.time_combo.addItems(["24小时制", "12小时制"])
        layout.addLayout(row("时间格式：", self.time_combo))
        self.top_check = QCheckBox("窗口置顶")
        layout.addWidget(self.top_check)
        self.pass_check = QCheckBox("鼠标穿透（无法移动、不显示设置按钮）")
        layout.addWidget(self.pass_check)
        self.shadow_check = QCheckBox("启用阴影")
        layout.addWidget(self.shadow_check)
        self.shadow_color_btn = QPushButton("阴影颜色")
        self.shadow_color_btn.clicked.connect(self.choose_shadow_color)
        layout.addLayout(row("阴影颜色：", self.shadow_color_btn))
        self.shadow_spin = QSpinBox()
        self.shadow_spin.setRange(0, 50)
        layout.addLayout(row("阴影大小：", self.shadow_spin))
        self.stroke_check = QCheckBox("启用描边")
        layout.addWidget(self.stroke_check)
        self.stroke_color_btn = QPushButton("描边颜色")
        self.stroke_color_btn.clicked.connect(self.choose_stroke_color)
        layout.addLayout(row("描边颜色：", self.stroke_color_btn))
        self.stroke_spin = QSpinBox()
        self.stroke_spin.setRange(0, 20)
        layout.addLayout(row("描边宽度：", self.stroke_spin))
        save_btn = QPushButton("保存并关闭")
        save_btn.clicked.connect(self.save_all)
        layout.addWidget(save_btn)
        self.setLayout(layout)

        self.font_box.currentFontChanged.connect(self.update_preview)
        self.size_spin.valueChanged.connect(self.update_preview)
        self.time_combo.currentTextChanged.connect(self.update_preview)
        self.top_check.toggled.connect(self.update_preview)
        self.pass_check.toggled.connect(self.update_preview)
        self.shadow_check.toggled.connect(self.update_preview)
        self.shadow_spin.valueChanged.connect(self.update_preview)
        self.stroke_check.toggled.connect(self.update_preview)
        self.stroke_spin.valueChanged.connect(self.update_preview)

    def choose_color(self):
        c = QColorDialog.getColor(QColor(self.parent.config["color"]), self, "选择文字颜色")
        if c.isValid():
            self.parent.config["color"] = c.name()
            self.color_btn.setStyleSheet(f"background-color: {c.name()};")
            self.update_preview()

    def choose_shadow_color(self):
        c = QColorDialog.getColor(QColor(self.parent.config["shadow_color"]), self, "选择阴影颜色")
        if c.isValid():
            self.parent.config["shadow_color"] = c.name()
            self.shadow_color_btn.setStyleSheet(f"background-color: {c.name()};")
            self.update_preview()

    def choose_stroke_color(self):
        c = QColorDialog.getColor(QColor(self.parent.config["stroke_color"]), self, "选择描边颜色")
        if c.isValid():
            self.parent.config["stroke_color"] = c.name()
            self.stroke_color_btn.setStyleSheet(f"background-color: {c.name()};")
            self.update_preview()

    def update_preview(self):
        if self.is_init:
            return
        c = self.parent.config
        c["font_family"] = self.font_box.currentFont().family()
        c["font_size"] = self.size_spin.value()
        c["time_format"] = 24 if self.time_combo.currentText() == "24小时制" else 12
        c["topmost"] = self.top_check.isChecked()
        c["mouse_pass"] = self.pass_check.isChecked()
        c["shadow"] = self.shadow_check.isChecked()
        c["shadow_radius"] = self.shadow_spin.value()
        c["stroke"] = self.stroke_check.isChecked()
        c["stroke_width"] = self.stroke_spin.value()

        now = datetime.now().strftime("%H:%M:%S" if c["time_format"] == 24 else "%I:%M:%S %p")
        self.preview.setText(now)
        self.preview.setFont(QFont(c["font_family"], c["font_size"]))
        self.parent.apply_style()

    def save_all(self):
        c = self.parent.config
        c["font_family"] = self.font_box.currentFont().family()
        c["font_size"] = self.size_spin.value()
        c["time_format"] = 24 if self.time_combo.currentText() == "24小时制" else 12
        c["topmost"] = self.top_check.isChecked()
        c["mouse_pass"] = self.pass_check.isChecked()
        c["shadow"] = self.shadow_check.isChecked()
        c["shadow_radius"] = self.shadow_spin.value()
        c["stroke"] = self.stroke_check.isChecked()
        c["stroke_width"] = self.stroke_spin.value()

        self.parent.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            (Qt.WindowType.WindowStaysOnTopHint if c["topmost"] else Qt.WindowType.Widget)
        )
        self.parent.show()
        self.parent.save_config()
        self.close()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    clock = FloatClock()
    clock.show()
    sys.exit(app.exec())
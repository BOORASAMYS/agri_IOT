#include <TFT_eSPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include "image.h"

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

const char* ssid = "Agri_IoT";
const char* password = "Agri@123";

WebServer server(80);

// ✅ FIXED Gateway
IPAddress local_IP(192, 168, 0, 5);
IPAddress gateway(192, 168, 0, 1);   // ✅ correct
IPAddress subnet(255, 255, 255, 0);

#define IMG_W 240
#define IMG_H 280

#define HEX565(c) tft.color565((c>>16)&0xFF, (c>>8)&0xFF, c&0xFF)
#define WATER_COLOR HEX565(0x5BC0EB)

#define greenlight 27
#define redlight 26

int field = 2;

// Data
float rlevel = 0.0;
float rph = 0.0;
float rmoisture = 0.0;

String state = "";
String lastStatus = "";

bool newdata = true;
bool pump_on = false;

// Status screen control
bool showStatusScreen = false;
bool statusDrawn = false;
unsigned long statusStartTime = 0;

// WiFi state tracking
bool lastWiFiState = false;

//----------------------------------

void drawValue(int x, int y, const char* text, uint16_t color) {
  int w = 120, h = 30;

  for (int row = 0; row < h; row++) {
    tft.pushImage(x, y + row, w, 1,
      &image[(y + row) * IMG_W + x]);
  }

  sprite.fillSprite(TFT_BLACK);
  sprite.setTextSize(3);
  sprite.setTextColor(color, TFT_BLACK);
  sprite.setCursor(0, 5);
  sprite.print(text);
  sprite.pushSprite(x, y, TFT_BLACK);
}

//----------------------------------

void updateValues() {
  char buffer[20];

  sprintf(buffer, "%.1fcm", rlevel);
  drawValue(105, 80, buffer, WATER_COLOR);

  sprintf(buffer, "%.1f%%", rmoisture);
  drawValue(115, 150, buffer, TFT_GREEN);

  sprintf(buffer, "%.1f", rph);
  drawValue(120, 220, buffer, TFT_WHITE);
}

//----------------------------------

void drawWiFiStatus(bool connected) {
  int x = 140, y = 10;
  int w = 80, h = 25;

  for (int row = 0; row < h; row++) {
    tft.pushImage(x, y + row, w, 1,
      &image[(y + row) * IMG_W + x]);
  }

  if (connected) {
    tft.fillCircle(x + 3, y + 10, 5, TFT_GREEN);
    tft.setTextFont(1);
    tft.setCursor(x + 13, y + 3);
    tft.setTextSize(2);
    tft.print("Online");
  } else {
    tft.fillCircle(x + 3, y + 10, 5, TFT_RED);
    tft.setTextFont(1);
    tft.setCursor(x + 13, y + 3);
    tft.setTextSize(2);
    tft.print("Offline");
  }
}

//----------------------------------

void drawField() {
  tft.setTextColor(TFT_WHITE);
  tft.setTextFont(1);
  tft.setTextSize(2);
  tft.setCursor(100, 40);
  tft.print(field);
}

//----------------------------------

void seperateScreen(String msg) {
  tft.fillScreen(TFT_BLACK);

  tft.setTextColor(TFT_WHITE);
  tft.setTextFont(2);
  tft.setTextSize(3);

  tft.setTextDatum(MC_DATUM); // center text
  tft.drawString(msg, 120, 140);
}

//----------------------------------

void handleData() {
  String response = "";

  if (server.hasArg("level")) {
    rlevel = server.arg("level").toFloat();
    response += "Level OK | ";
  }

  if (server.hasArg("pump")) {
    String pump = server.arg("pump");

    if (pump == "on") pump_on = true;
    else if (pump == "off") pump_on = false;

    response += "Pump OK | ";
  }

  if (server.hasArg("ph")) {
    rph = server.arg("ph").toFloat();
    response += "pH OK | ";
  }

  if (server.hasArg("moisture")) {
    rmoisture = server.arg("moisture").toFloat();
    response += "Moisture OK | ";
  }

  // ✅ FIXED STATUS HANDLING
  if (server.hasArg("status")) {
    String STATUS = server.arg("status");

    if (STATUS != "") {
      state = STATUS;
    }

    response += "Status OK | ";
  }

  if (response == "") {
    server.send(400, "text/plain", "No valid parameters");
  } else {
    newdata = true;
    server.send(200, "text/plain", response);
  }
}

//----------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(greenlight, OUTPUT);
  pinMode(redlight, OUTPUT);

  tft.init();
  tft.setRotation(0);
  tft.setSwapBytes(true);

  sprite.createSprite(120, 30);

  WiFi.config(local_IP, gateway, subnet);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    tft.pushImage(0, 0, IMG_W, IMG_H, image);
    drawWiFiStatus(false);
    delay(500);
  }

  tft.pushImage(0, 0, IMG_W, IMG_H, image);
  drawWiFiStatus(true);

  server.on("/set", handleData);
  server.begin();
}

//----------------------------------

void loop() {
  bool currentWiFiState = (WiFi.status() == WL_CONNECTED);

  // WiFi change detection
  if (currentWiFiState != lastWiFiState) {
    tft.pushImage(0, 0, IMG_W, IMG_H, image);
    drawWiFiStatus(currentWiFiState);
    lastWiFiState = currentWiFiState;
  }

  server.handleClient();

  // Status change trigger
  if (state != lastStatus) {
    showStatusScreen = true;
    statusStartTime = millis();
    statusDrawn = false;
    lastStatus = state;
  }

  // Status screen logic
  if (showStatusScreen) {

    if (!statusDrawn) {
      seperateScreen(state);
      statusDrawn = true;
    }

    if (millis() - statusStartTime > 5000) {
      showStatusScreen = false;
      tft.pushImage(0, 0, IMG_W, IMG_H, image);
    }
    drawWiFiStatus(currentWiFiState);

  } else {

    if (newdata) {
      updateValues();
      newdata = false;
    }

    drawField();

    if (pump_on) {
      digitalWrite(greenlight, HIGH);
      digitalWrite(redlight, LOW);
    } else {
      digitalWrite(greenlight, LOW);
      digitalWrite(redlight, HIGH);
    }
  }

  delay(50);
}
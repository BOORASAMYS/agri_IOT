#include <TFT_eSPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WebServer.h>

#include "image.h"

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);

const char* ssid = "Agri_IoT";
const char* password = "Agri@123";
WebServer server(80);

IPAddress local_IP(192, 168, 0, 4);
IPAddress gateway(192, 168, 0, 255);
IPAddress subnet(255, 255, 255, 0);

#define IMG_W 240
#define IMG_H 280

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C 

#define HEX565(c) tft.color565((c>>16)&0xFF, (c>>8)&0xFF, c&0xFF)
#define WATER_COLOR HEX565(0x5BC0EB)

#define greenlight 27
#define redlight 26

// 🔥 Ultrasonic pins
#define TRIG_PIN 33
#define ECHO_PIN 35

// 🔥 Tank settings (CHANGE THESE)
#define TANK_HEIGHT_CM 15   // full tank height
#define MAX_FILL_CM 5       // distance when FULL

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

int field = 1;

float rlevel = 0.0;
float rph = 0.0;
float rmoisture = 0.0;

int maintanklevel = 0;
int lastSentTankLevel = 0;

bool pump_on = false;
bool newdata = true;
bool levelchagne = false;

// Status screen control
bool showStatusScreen = false;
bool statusDrawn = false;
unsigned long statusStartTime = 0;

boolean lastWiFiState = false;

String state = "";
String lastStatus = "";

//----------------------------------

void drawWiFiStatus(bool connected) {
  int x = 140, y = 10, w = 80, h = 25;

  for (int row = 0; row < h; row++) {
    tft.pushImage(x, y + row, w, 1,
      &image[(y + row) * IMG_W + x]);
  }

  if (connected) {
    tft.fillCircle(x + 3, y + 10, 5, TFT_GREEN);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextSize(2);
    tft.setCursor(x + 13, y + 3);
    tft.print("Online");
  } else {
    tft.fillCircle(x + 3, y + 10, 5, TFT_RED);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextSize(2);
    tft.setCursor(x + 13, y + 3);
    tft.print("Offline");
  }
}

//----------------------------------

void oled(int level) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  if (level > 128) level = 128;

  display.fillRect(0, 0, level, 20, SSD1306_WHITE);
  display.display();
}

//----------------------------------

long readUltrasonicDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // timeout 30ms

  long distance = duration * 0.034 / 2;
  Serial.print("Distance: ");
  Serial.println(distance);
  return distance;
}

//----------------------------------
void sensorread() {
  long distance = readUltrasonicDistance();

  // clamp values
  if (distance < MAX_FILL_CM) distance = MAX_FILL_CM;
  if (distance > TANK_HEIGHT_CM) distance = TANK_HEIGHT_CM;

  // convert to %
  maintanklevel = map(distance, TANK_HEIGHT_CM, MAX_FILL_CM, 0, 100);

  oled(maintanklevel * 1.2);
  

  if (abs(maintanklevel - lastSentTankLevel) >= 5) {
    lastSentTankLevel = maintanklevel;
    levelchagne = true;
  }
}

//----------------------------------

void handleTankLevel() {
  server.send(200, "text/plain", String(maintanklevel));
  levelchagne = false;
}

//----------------------------------


void drawValue(int x, int y, const char* text, uint16_t color) {
  int w = 120, h = 30;

  for (int row = 0; row < h; row++) {
    tft.pushImage(x, y + row, w, 1,
      &image[(y + row) * IMG_W + x]);
  }

  sprite.fillSprite(TFT_BLACK);
  sprite.setTextColor(color, TFT_BLACK);
  sprite.setTextSize(3);
  sprite.setCursor(0, 5);
  sprite.print(text);
  sprite.pushSprite(x, y, TFT_BLACK);
}

//---------------------

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

void handleData() {
  String response = "";

  if (server.hasArg("level")) {
    rlevel = server.arg("level").toInt();
    response += "Level OK | ";
  }

  if (server.hasArg("pump")) {
    pump_on = (server.arg("pump") == "on");
    response += "Pump OK | ";
  }

  if (server.hasArg("ph")) {
    rph = server.arg("ph").toInt();
    response += "pH OK | ";
  }

  if (server.hasArg("moisture")) {
    rmoisture = server.arg("moisture").toInt();
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

void fieldupadete() {
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

void setup() {
  Serial.begin(115200);

  Wire.begin(21, 22);

  display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
  pinMode(greenlight, OUTPUT);
  pinMode(redlight, OUTPUT);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

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
  server.on("/tank", handleTankLevel);
  server.begin();
}

//----------------------------------

void loop() {
  bool currentWiFiState = (WiFi.status() == WL_CONNECTED);

  if (currentWiFiState != lastWiFiState) {
    tft.pushImage(0, 0, IMG_W, IMG_H, image);
    drawWiFiStatus(currentWiFiState);
    lastWiFiState = currentWiFiState;
    updateValues();
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

  fieldupadete();
  sensorread();

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

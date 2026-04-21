#include <TFT_eSPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Servo.h>

#include "greenonline.h"
#include "greenoffline.h"

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);
Servo gate;

const char* ssid = "Agri_IoT";
const char* password = "Agri@123";
WebServer server(80);

// Static IP
IPAddress local_IP(192, 168, 0, 7);
IPAddress gateway(192, 168, 0, 255);
IPAddress subnet(255, 255, 255, 0);

#define IMG_W 240
#define IMG_H 280

#define HEX565(c) tft.color565((c>>16)&0xFF, (c>>8)&0xFF, c&0xFF)

#define gatePin 27
#define getesensor 34
#define firesensor 35
#define buzzer 33

#define Fan 21
#define ldrTrigger 13
#define ldr 36
#define Thres 2000

// Variables
float temperature = 0.0;
float humidity = 0.0;
bool fan_on = false;

bool gateOpen = false;
unsigned long gateStartTime = 0;

int stableCount = 0;
bool fire_on = false;

bool newdata = true;
bool lastWiFiState = false;


//--------------------------------------------------

void drawValue(int x, int y, const char* text, uint16_t color) {
  int w = 120, h = 30;

  for (int row = 0; row < h; row++) {
    tft.pushImage(x, y + row, w, 1,
      &greenonline[(y + row) * IMG_W + x]);
  }

  sprite.fillSprite(TFT_BLACK);
  sprite.setTextColor(color, TFT_BLACK);
  sprite.setTextSize(3);
  sprite.setCursor(0, 5);
  sprite.print(text);
  sprite.pushSprite(x, y, TFT_BLACK);
}

//--------------------------------------------------

void updateValues() {
  char buffer[20];

  sprintf(buffer, "%.1f", temperature);
  drawValue(130, 75, buffer, TFT_WHITE);

  sprintf(buffer, "%.1f%%", humidity);
  drawValue(125, 150, buffer, TFT_WHITE);

  if (fan_on) {
    drawValue(130, 225, "ON", TFT_WHITE);
    digitalWrite(Fan, LOW);
  } else {
    drawValue(130, 225, "OFF", TFT_WHITE);
    digitalWrite(Fan, HIGH);
  }
}

//--------------------------------------------------

void handleData() {
  String response = "";

  if (server.hasArg("temp")) {
    temperature = server.arg("temp").toFloat();
    response += "Temp OK | ";
  }

  if (server.hasArg("humid")) {
    humidity = server.arg("humid").toFloat();
    response += "Humid OK | ";
  }

  if (server.hasArg("fan")) {
    String fan = server.arg("fan");
    fan_on = (fan == "on");
    response += "Fan OK | ";
  }

  if (response == "") {
    server.send(400, "text/plain", "No valid parameters");
  } else {
    newdata = true;
    server.send(200, "text/plain", response);
  }
}

//--------------------------------------------------

void handleFireAPI() {
  if (fire_on)
    server.send(200, "text/plain", "Fire Detected");
  else
    server.send(200, "text/plain", "No Fire");
}

//--------------------------------------------------

void fire() {
  int val = digitalRead(firesensor);

  if (val == LOW) stableCount++;
  else stableCount = 0;

  if (stableCount >= 30) {
    fire_on = true;

    static unsigned long buzzerTime = 0;

    if (millis() - buzzerTime > 1000) {
      digitalWrite(buzzer, HIGH);
      delay(500);
      digitalWrite(buzzer, LOW);
      buzzerTime = millis();
    }
  } else {
    fire_on = false;
  }
}

//--------------------------------------------------

void gateControl() {
  if (digitalRead(getesensor) == LOW && !gateOpen) {
    gate.write(90);
    gateOpen = true;
    gateStartTime = millis();
  }

  if (gateOpen && millis() - gateStartTime >= 3000) {
    gate.write(0);
    gateOpen = false;
  }
}

//--------------------------------------------------

void setup() {
  Serial.begin(115200);

  gate.attach(gatePin);
  gate.write(0);

  pinMode(getesensor, INPUT);
  pinMode(firesensor, INPUT_PULLUP);
  pinMode(buzzer, OUTPUT);
  pinMode(Fan, OUTPUT);
  pinMode(ldrTrigger, OUTPUT);
  pinMode(ldr, INPUT);

  digitalWrite(ldrTrigger, HIGH);
  digitalWrite(Fan, HIGH);

  tft.init();
  tft.setRotation(0);
  tft.setSwapBytes(true);
  sprite.createSprite(120, 30);

  WiFi.config(local_IP, gateway, subnet);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenoffline);
    delay(500);
  }

  tft.pushImage(0, 0, IMG_W, IMG_H, greenonline);

  server.on("/set", handleData);
  server.on("/fire", handleFireAPI);
  server.begin();
}

//--------------------------------------------------

void loop() {

  bool currentWiFiState = (WiFi.status() == WL_CONNECTED);

  if (!currentWiFiState && lastWiFiState) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenoffline);
  }

  if (currentWiFiState && !lastWiFiState) {
    tft.pushImage(0, 0, IMG_W, IMG_H, greenonline);
    updateValues();  // restore values
  }

  lastWiFiState = currentWiFiState;

  server.handleClient();

  // Always update display (important fix)
  if (newdata) {
    updateValues();
    newdata = false;
  }

  gateControl();
  fire();

  int ldrVal = analogRead(ldr);
  digitalWrite(ldrTrigger, (ldrVal < Thres) ? LOW : HIGH);

  delay(50);
}
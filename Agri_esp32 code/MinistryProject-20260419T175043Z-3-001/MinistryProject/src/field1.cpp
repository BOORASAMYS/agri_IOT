/*
#define TFT_MOSI 23
#define TFT_SCLK 18
#define TFT_CS   15  // Chip select control pin
#define TFT_DC   25  // Data Command control pin
#define TFT_RST   4  // Reset pin (could connect to RST pin)
*/



#include <TFT_eSPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <WebServer.h>

#include "fieldlevelonline.h"// #include "fieldlevel.h" contains the pixel data for the background image (240x280px)
#include "fieldleveloffline.h"

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite sprite = TFT_eSprite(&tft);


const char* ssid = "Agri_IoT";//Agri_IoT
const char* password = "Agri@123";//Agri@123
WebServer server(80);

// 🔥 Static IP settings
IPAddress local_IP(192, 168, 0, 4);   // choose free IP (192, 168, 0, ??)
IPAddress gateway(192, 168, 0, 255);      // from ipconfig (192, 168, 0, 255)
IPAddress subnet(255, 255, 255, 0); //(255, 255, 255, 0)


#define IMG_W 240// Image width in pixels
#define IMG_H 280// Image height in pixels

/////////////////////////////////////oled//////////////////////////////////////////////
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32

#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C 
////////////////////////////////////////////////////////////////////////////////////


#define HEX565(c) tft.color565((c>>16)&0xFF, (c>>8)&0xFF, c&0xFF)// Convert 24-bit RGB color to 16-bit RGB565 format
#define WATER_COLOR HEX565(0x5BC0EB)// Light Blue (Water)
#define MOIST_COLOR HEX565(0x019b03)// Dark Green (Soil Moisture)

#define greenlight 26 //for esp32
#define redlight 27 //  for esp32
#define watersensor 33 // water level sensor pin


Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);



int field = 1;// 1, 2, 3

//////////////////////////////////
float waterlevel = 0.0;
float moisture = 0.0;
float ph = 50.0;
float rlevel = 0.0;
float rph = 0.0;
float rmoisture = 0.0;
int maintanklevel = 0;
int lastSentTankLevel = 0;

bool pump_on = false;
bool newdata = true;
bool levelchagne = true;
//////////////////////////////////




void sensorread();
void updateValues();
void handleData();
void fieldupadete();
bool pumpstate();
void oled(int maintanklevel);
void handleTankLevel();

void setup() {
  Serial.begin(115200);



  ////////////////////////////////////oled//////////////////////////////////////////////
  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println("OLED not found");
    while (true);
  }
 /////////////////////////////////////////////////////////////////////////////////////



  pinMode(greenlight, OUTPUT); digitalWrite(greenlight, HIGH); 
  pinMode(redlight, OUTPUT); digitalWrite(redlight, HIGH); 
  pinMode(watersensor, INPUT);


  tft.init();
  tft.setRotation(0);
  tft.setSwapBytes(true);

  sprite.createSprite(120, 30);// Create sprite (small area for text)
  

  if (!WiFi.config(local_IP, gateway, subnet)) Serial.println("Static IP Failed");// 🔥 Apply static IP BEFORE connecting

  WiFi.begin(ssid, password);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    tft.pushImage(0, 0, IMG_W, IMG_H, fieldleveloffline);// Draw background UI once
    delay(500);
    Serial.print(".");
  }
  tft.pushImage(0, 0, IMG_W, IMG_H, fieldlevelonline);// Draw background UI once

  Serial.println("\nConnected!");
  Serial.print("IP Address: http://");
  Serial.print(WiFi.localIP());
  Serial.println("/set?level=VALUE&pump=on|off");

  server.on("/set", handleData);
  server.on("/tank", handleTankLevel);
  server.begin();

}

boolean lastWiFiState = false; // Track last WiFi state for change detection
void loop() {
  bool currentWiFiState = (WiFi.status() == WL_CONNECTED);

  // If WiFi just disconnected
  if (!currentWiFiState && lastWiFiState == true) {
    tft.pushImage(0, 0, IMG_W, IMG_H, fieldleveloffline);
    Serial.println("WiFi Lost");
  }

  // If WiFi just connected
  if (currentWiFiState && lastWiFiState == false) {
    tft.pushImage(0, 0, IMG_W, IMG_H, fieldlevelonline);
    Serial.println("WiFi Connected");
  }

  // Update last state
  lastWiFiState = currentWiFiState;

  server.handleClient();
  if(newdata){
    updateValues();
    newdata = false; // Reset flag after updating values
  }
  fieldupadete();
  sensorread();

  if(levelchagne){
    handleTankLevel();
    levelchagne = false;
  }

  if(pump_on){
    digitalWrite(greenlight, HIGH);
    digitalWrite(redlight, LOW);
  }
  else{
    digitalWrite(greenlight, LOW);
    digitalWrite(redlight, HIGH);
  }

  delay(50);
}

void drawValue(int x, int y, const char* text, uint16_t color) {

  int w = 120;
  int h = 30;

  // ✅ Step 1: Restore background properly (row by row)
  for (int row = 0; row < h; row++) {
    tft.pushImage(
      x,
      y + row,
      w,
      1,
      &fieldlevelonline[(y + row) * IMG_W + x]
    );
  }

  // ✅ Step 2: Draw text using transparent sprite
  sprite.fillSprite(TFT_BLACK);
  sprite.setTextColor(color, TFT_BLACK); // Set text color with black background for transparency
  sprite.setTextSize(3);
  sprite.setCursor(0, 5);

  sprite.print(text);

  sprite.pushSprite(x, y, TFT_BLACK);

}

void updateValues() {
  char buffer[20];

  // WATER LEVEL
  sprintf(buffer, "%.1fcm", rlevel);
  drawValue(75, 90, buffer, WATER_COLOR);

  // MOISTURE
  sprintf(buffer, "%.1f%%", rmoisture);
  drawValue(75, 160, buffer, TFT_GREEN);

  // PH
  sprintf(buffer, "%.1f", rph);
  drawValue(75, 230, buffer, TFT_WHITE);


}

void handleData() {////////////////////////for field esp only////////////////////////////////////////////
  String response = "";

  // LEVEL
  if (server.hasArg("level")) {
    rlevel = server.arg("level").toInt();
    Serial.print("Level: ");
    Serial.println(rlevel);
    response += "Level OK | ";
  }

  // PUMP
  if (server.hasArg("pump")) {
    String pump = server.arg("pump");

    if (pump == "on") {
      pump_on = true;
      Serial.println("Pump ON");
      response += "Pump ON | ";
    } 
    else if (pump == "off") {
      pump_on = false;
      Serial.println("Pump OFF");
      response += "Pump OFF | ";
    }
  }

  // PH
  if (server.hasArg("ph")) {
    rph = server.arg("ph").toInt();
    Serial.print("pH: ");
    Serial.println(rph);
    response += "pH OK | ";
  }

  // MOISTURE
  if (server.hasArg("moisture")) {
    rmoisture = server.arg("moisture").toInt();
    Serial.print("Moisture: ");
    Serial.println(rmoisture);
    response += "Moisture OK | ";
  }

  // FINAL RESPONSE (ONLY ONCE)
  if (response == "") {
    server.send(400, "text/plain", "No valid parameters");
  } else {
    newdata = true; // Flag to indicate new data received
    server.send(200, "text/plain", response);
  }
}

bool pumpstate(){
  if(server.hasArg("pump")){
    String val = server.arg("pump");
    if(val == "on"){
      Serial.println("Pump ON");
      server.send(200, "text/plain", "Pump turned ON");
      return true;
    }
    else if(val == "off"){
      Serial.println("Pump OFF");
      server.send(200, "text/plain", "Pump turned OFF");
      return false;
    }
  }
}

void fieldupadete(){
  tft.setTextColor(TFT_WHITE);
  tft.setTextSize(2.5);
  tft.setCursor(100, 40);
  tft.print((String)field);
}

void sensorread(){
    float value  = analogRead(watersensor);
    if(value < 1300) value = 1300; // Cap the value to avoid outliers
    maintanklevel = map(value, 1300, 4095, 0, 100); // Map the raw sensor value to a percentage (0-100%)
    oled(maintanklevel);
    if (abs(maintanklevel - lastSentTankLevel) >= 5)  {lastSentTankLevel = maintanklevel;  levelchagne = true;  }

  }

void oled(int maintanklevel){
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  if(maintanklevel >= 100) maintanklevel = 128; 
  Serial.print(" ");
  Serial.println(maintanklevel);
  display.fillRect(0, 0, maintanklevel, 20, SSD1306_WHITE);  
  display.display();
}

void handleTankLevel() {
  String reading = String(maintanklevel);
  server.send(200, "text/plain", reading);
}


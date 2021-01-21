let Service,
    Characteristic;
const _       = require('lodash');
const request = require('request');
const moment  = require('moment');
const qs      = require('querystring');

module.exports = function (homebridge) {
  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('homebridge-mostat', 'mostat', Thermostat);
};

function Thermostat(log, config) {
  this.log = log;

  this.access_token = config['access_token'];
  this.device_uuid  = config['device_uuid'];
  this.name         = config['name'];
  this.thermometer  = parseInt(config['thermometer']) === 1;

  this.mostat_cache = {};

  this.manufacturer = 'AlienGreen';
  this.model        = 'Mostat';
  this.serial       = this.device_uuid;

  this.apiroute = 'https://app.aliengreen.ge/api';

  this.currentHumidity = true;
  this.targetHumidity  = false;

  this.temperatureDisplayUnits   = 0;
  this.maxTemp                   = 30;
  this.minTemp                   = 5;
  this.minStep                   = 0.5;
  this.targetRelativeHumidity    = 90;
  this.currentRelativeHumidity   = 90;
  this.targetTemperature         = 25;
  this.currentTemperature        = 20;
  this.targetHeatingCoolingState = 3;
  this.heatingCoolingState       = 1;

  this.log(this.name, this.apiroute);

  if(this.thermometer) {
    this.service = new Service.TemperatureSensor(this.name);
  } else {
    this.service = new Service.Thermostat(this.name);
  }
  this.humidty = new Service.HumiditySensor(this.name + ' Humidity');
  this.battery = new Service.BatteryService(this.name + ' Room Sensor Battery');
  this.outside = new Service.TemperatureSensor(this.name + ' Outside Temperature');

}

Thermostat.prototype = {

  identify: function (callback) {
    this.log('Identify requested!');
    callback();
  },

  _httpRequest: function (url, body, method, callback) {
    const self = this;

    if (url === 'https://app.aliengreen.ge/api/list') {
      if (this.mostat_cache.hasOwnProperty('list_cache')) {
        let payload = this.mostat_cache['list_cache'];
        if (_.isString(payload)) {
          payload = JSON.parse(payload);
        }
        const device = this._findDevice(payload);
        if (moment(device.caching_date).add(10, 'seconds').isAfter(moment())) {
          callback(null, null, payload);
          return payload;
        }
      }
    }

    request({
        url:     url,
        body:    body,
        method:  method,
        timeout: 1000,
        headers: {
          'User-Agent':    'Mostat Homekit',
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + this.access_token,
        },
      },
      function (error, response, body) {
        if (!error && url === 'https://app.aliengreen.ge/api/list') {
          self.mostat_cache['list_cache'] = body;

          if (_.isEmpty(self.user_uuid)) {
            const payload  = JSON.parse(body);
            const device   = self._findDevice(payload);
            self.user_uuid = payload.uuid;
            self.name      = device.meta.name;
          }
        }
        callback(error, response, body);
      });
  },

  _findDevice(payload) {
    if (_.isString(payload)) {
      payload = JSON.parse(payload);
    }
    let selected_device = null;
    _.forEach(payload.devices, device => {
      if (device.device_uuid === this.device_uuid) {
        selected_device = device;
        return false;
      }
    });

    return selected_device;
  },

  getCurrentHeatingCoolingState: function (callback) {
    this.log('[+] getCurrentHeatingCoolingState from:', this.apiroute + '/list');
    const url = this.apiroute + '/list';
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentHeatingCoolingState: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device                    = this._findDevice(json);
        const relay                     = device.boiler.relay;
        const state                     = relay === 1 ? 2 : 0;
        this.currentHeatingCoolingState = state;

        this.log('[*] currentHeatingCoolingState: %s', this.currentHeatingCoolingState);
        callback(null, this.currentHeatingCoolingState);
      }
    }.bind(this));
  },

  getTargetHeatingCoolingState: function (callback) {
    this.log('[+] getTargerHeatingCoolingState from:', this.apiroute + '/list');
    const url = this.apiroute + '/list';
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting targetHeatingCoolingState: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device                    = this._findDevice(json);
        const relay                     = device.boiler.relay;
        const state                     = relay === 1 ? 2 : 0;
        this.currentHeatingCoolingState = state;
        this.log('[*] targetHeatingCoolingState: %s', this.currentHeatingCoolingState);
        callback(null, this.targetHeatingCoolingState);
      }
    }.bind(this));
  },

  setTargetHeatingCoolingState: function (value, callback) {
    this.log('[+] setTargetHeatingCoolingState from %s to %s', this.targetHeatingCoolingState, value);
    const url   = this.apiroute + '/device/set_away';
    const state = value === 0 || value === 2 ? 2 : 0;
    this._httpRequest(url, JSON.stringify({
      user_uuid:   this.user_uuid,
      device_uuid: this.device_uuid,
      away:        state,
    }), 'POST', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error setting targetHeatingCoolingState: %s', error.message);
        callback(error);
      } else {
        this.log('[*] Sucessfully set targetHeatingCoolingState to %s', state);
        this.targetHeatingCoolingState = state;
        this.service.setCharacteristic(Characteristic.CurrentHeatingCoolingState, state);
        callback();
      }
    }.bind(this));
  },

  getCurrentTemperature: function (callback) {
    this.log('[+] getCurrentTemperature from:', this.apiroute + '/list');
    const url  = this.apiroute + '/list';
    const self = this;
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentTemperature: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device = self._findDevice(json);
        self.service.getCharacteristic(Characteristic.Name).setValue(self.name);
        const roomsensor        = _.first(device.roomsensors);
        const temperature       = roomsensor.temperature;
        self.currentTemperature = parseFloat(temperature);

        self.log('[*] currentTemperature: %s', self.currentTemperature);
        callback(null, self.currentTemperature);
      }
    }.bind(this));
  },


  getOutsideTemperature: function (callback) {
    this.log('[+] getCurrentTemperature from:', this.apiroute + '/list');
    const url  = this.apiroute + '/list';
    const self = this;
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentTemperature: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device = self._findDevice(json);
        self.service.getCharacteristic(Characteristic.Name).setValue(self.name);
        const temperature       = device.outside.temperature;
        self.currentTemperature = parseFloat(temperature);

        self.log('[*] currentTemperature: %s', self.currentTemperature);
        callback(null, self.currentTemperature);
      }
    }.bind(this));
  },

  getTargetTemperature: function (callback) {
    this.log('[+] getTargetTemperature from:', this.apiroute + '/list');
    const url = this.apiroute + '/list';
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting targetTemperature: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device               = this._findDevice(json);
        const roomsensor           = _.first(device.roomsensors);
        const setpoint_temperature = roomsensor.setpoint_temperature;
        this.targetTemperature     = parseFloat(setpoint_temperature);

        this.log('[*] targetTemperature: %s', this.targetTemperature);
        callback(null, this.targetTemperature);
      }
    }.bind(this));
  },

  setTargetTemperature: function (value, callback) {
    this.log('[+] setTargetTemperature from %s to %s', this.targetTemperature, value);
    const url = this.apiroute + '/device/set_target_temp';
    this._httpRequest(url, JSON.stringify({
      user_uuid:   this.user_uuid,
      device_uuid: this.device_uuid,
      target_temp: value,
    }), 'POST', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error setting targetTemperature', error.message);
        callback(error);
      } else {
        this.log('[*] Sucessfully set targetTemperature to %s', value);
        callback();
      }
    }.bind(this));
  },

  getCurrentRelativeHumidity: function (callback) {
    this.log('[+] getCurrentRelativeHumidity from:', this.apiroute + '/list');
    const url = this.apiroute + '/list';
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentRelativeHumidity: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device                 = this._findDevice(json);
        const roomsensor             = _.first(device.roomsensors);
        const humidity               = roomsensor.humidity;
        this.currentRelativeHumidity = parseFloat(humidity);

        this.log('[*] currentRelativeHumidity: %s', this.currentRelativeHumidity);
        callback(null, this.currentRelativeHumidity);
      }
    }.bind(this));
  },

  getTargetRelativeHumidity: function (callback) {
    this.log('[+] getTargetRelativeHumidity from:', this.apiroute + '/list');
    const url = this.apiroute + '/list';
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting targetRelativeHumidity: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device                = this._findDevice(json);
        const roomsensor            = _.first(device.roomsensors);
        const humidity              = roomsensor.humidity;
        this.targetRelativeHumidity = parseFloat(humidity);

        this.log('[*] targetRelativeHumidity: %s', this.targetRelativeHumidity);
        callback(null, this.targetRelativeHumidity);
      }
    }.bind(this));
  },

  setTargetRelativeHumidity: function (value, callback) {
    callback(new Error('Not Supported'));
  },

  getTemperatureDisplayUnits: function (callback) {
    //this.log("getTemperatureDisplayUnits:", this.temperatureDisplayUnits);
    callback(null, this.temperatureDisplayUnits);
  },

  setTemperatureDisplayUnits: function (value, callback) {
    this.log('[*] setTemperatureDisplayUnits from %s to %s', this.temperatureDisplayUnits, value);
    callback();
  },

  getBatteryLevel: function (callback) {
    this.log('[+] getCurrentTemperature from:', this.apiroute + '/list');
    const url  = this.apiroute + '/list';
    const self = this;
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentTemperature: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device       = self._findDevice(json);
        const roomsensor   = _.first(device.roomsensors);
        const batteryLevel = roomsensor.battery_level;
        self.batteryLevel  = parseFloat(batteryLevel);

        self.log('[*] batteryLevel: %s', self.batteryLevel);
        callback(null, self.batteryLevel);
      }
    }.bind(this));
  },

  getBatteryCondition: function (callback) {
    this.log('[+] getCurrentTemperature from:', this.apiroute + '/list');
    const url  = this.apiroute + '/list';
    const self = this;
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log('[!] Error getting currentTemperature: %s', error.message);
        callback(error);
      } else {
        let json = responseBody;
        if (_.isString(responseBody)) {
          json = JSON.parse(responseBody);
        }
        const device          = self._findDevice(json);
        const roomsensor      = _.first(device.roomsensors);
        self.batteryCondition = roomsensor.battery_condition === 'replace soon' || roomsensor.battery_condition === 'replace' ? 1 : 0;

        self.log('[*] batteryLevel: %s', self.batteryCondition);
        callback(null, self.batteryCondition);
      }
    }.bind(this));
  },

  getName: function (callback) {
    this.log('getName :', this.name);
    callback(null, this.name);
  },

  getServices: function () {

    this.informationService = new Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model)
        .setCharacteristic(Characteristic.SerialNumber, this.serial);

    if(this.thermometer) {
      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this));
    } else {
      this.service
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getCurrentHeatingCoolingState.bind(this));

      this.service
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getTargetHeatingCoolingState.bind(this))
        .on('set', this.setTargetHeatingCoolingState.bind(this));

      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this));

      this.service
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', this.getTargetTemperature.bind(this))
        .on('set', this.setTargetTemperature.bind(this));

      this.service
        .getCharacteristic(Characteristic.TemperatureDisplayUnits)
        .on('get', this.getTemperatureDisplayUnits.bind(this))
        .on('set', this.setTemperatureDisplayUnits.bind(this));

      this.service
        .getCharacteristic(Characteristic.Name)
        .on('get', this.getName.bind(this));
    }

    if (this.currentHumidity) {
      this.service
          .getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .on('get', this.getCurrentRelativeHumidity.bind(this));
    }

    if (this.targetHumidity) {
      this.service
          .getCharacteristic(Characteristic.TargetRelativeHumidity)
          .on('get', this.getTargetRelativeHumidity.bind(this))
          .on('set', this.setTargetRelativeHumidity.bind(this));
    }

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
          minValue: this.minTemp,
          maxValue: this.maxTemp,
          minStep:  this.minStep,
        });

    this.service.getCharacteristic(Characteristic.TargetTemperature)
        .setProps({
          minValue: this.minTemp,
          maxValue: this.maxTemp,
          minStep:  this.minStep,
        });

    this.humidty
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', this.getCurrentRelativeHumidity.bind(this));

    this.battery
        .getCharacteristic(Characteristic.BatteryLevel)
        .on('get', this.getBatteryLevel.bind(this));

    this.battery
        .getCharacteristic(Characteristic.ChargingState)
        .on('get', cb => cb(Characteristic.ChargingState.NOT_CHARGEABLE));

    this.battery
        .getCharacteristic(Characteristic.StatusLowBattery)
        .on('get', this.getBatteryCondition.bind(this));


    this.outside
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getOutsideTemperature.bind(this));


    return [this.informationService, this.service, this.humidty, this.outside, this.battery];
  },
};

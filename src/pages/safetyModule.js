import React, { Component } from 'react'
import {
  Text, View, StyleSheet, Button, Alert, Dimensions
} from 'react-native'
import { BleManager } from 'react-native-ble-plx';
import aesjs from "aes-js";
import { btoa, concatArrayAndCommand, base64ToArrayBuffer, arrayToBase64 } from '../utilities/helperFunctions'

const blekey = new Uint8Array([245, 210, 41, 135, 101, 10, 29, 130, 5, 171, 130, 190, 185, 56, 89, 207]);

export default class SafetyModule extends Component {
  constructor(props) {
    super(props);
    this.manager = new BleManager();
    this.state = {
      deviceList: [],
      connectedDevice: null,
      scanning: false,
      disableConnectButton: false,
    }

    this.monitor = null;
  }
  deviceIdSet = new Set();

  async componentDidMount() {
  }

  /** search for devices and manage discovered devices */

  searchDevices = () => {
    this.deviceIdSet.clear();
    this.setState({ scanning: true, deviceList: [] });
    this.manager.startDeviceScan(null, null, (err, device) => {
      if (err) {
        this.setState({ scanning: false })
        this.showAlert("Error searching for devices", err);
      }
      this.handleDiscoverPeripheral(device)
    })
  }

  stopDeviceSearch = () => {
    this.manager.stopDeviceScan();
    this.setState({ scanning: false });
  }

  handleDiscoverPeripheral = (device) => {
    if (!this.deviceIdSet.has(device.id)) {
      this.deviceIdSet.add(device.id);
      const newDeviceList = this.state.deviceList;
      newDeviceList.push(device);
      this.setState({ deviceList: newDeviceList });
    }
  };

  /** end of - search for devices and manage discovered devices */

  /** Connect and authenticate device */

  connectToDevice = async (deviceId) => {
    this.stopDeviceSearch();
    this.setState({ disableConnectButton: true });
    this.manager.connectToDevice(deviceId)
      .then(async (device) => {
        await device.discoverAllServicesAndCharacteristics();
        //Step 01
        device.writeCharacteristicWithoutResponseForService('0000fee1-0000-1000-8000-00805f9b34fb', '00000009-0000-3512-2118-0009af100700', btoa('\x01\x00'))
          .catch(err => {
            this.showAlert("Intial write failed", err);
          })
        this.monitor = device.monitorCharacteristicForService('0000fee1-0000-1000-8000-00805f9b34fb', '00000009-0000-3512-2118-0009af100700', (error, characteristic) => {
          this.handleCharacteristicChange(error,characteristic,device);
        });
        let connectionKey = concatArrayAndCommand([1, 8], blekey);
        // Step 02
        device.writeCharacteristicWithoutResponseForService('0000fee1-0000-1000-8000-00805f9b34fb', '00000009-0000-3512-2118-0009af100700', arrayToBase64(connectionKey))
          .catch(error => {
            this.showAlert("Sending our key to device failed", error);
          })
      })
  }

  handleCharacteristicChange = (error, characteristic,device) => {
    if (error) {
      console.log('Characterisctic monitoring stopped',error);
    }
    if (characteristic != null) {
      console.log(characteristic.value);
      if (characteristic.value == 'EAEC') {
        this.setState({ disableConnectButton: false });
        this.showAlert("Error", "User didn't confirm pairing on device");
      }
      else if (characteristic.value == 'EAME') {
        this.setState({ disableConnectButton: false })
        this.showAlert("Error", "Unknown error occured");

      }
      else if (characteristic.value == 'EAMB') {
        this.setState({ disableConnectButton: false, connectedDevice: device.id });
        this.handleSuccess();
      }
      else if (characteristic.value == 'EAEB') {
        // Step 03
        this.requestDeviceKey(device)
      }
      else {
        // Step 04
        this.authenticateDevice(characteristic, device);
      }
    }
  }

  requestDeviceKey = (device) => {
    device.writeCharacteristicWithoutResponseForService('0000fee1-0000-1000-8000-00805f9b34fb', '00000009-0000-3512-2118-0009af100700', btoa('\x02\x00'))
      .catch(error => {
        this.showAlert("Error requesting device key", error)
      })
  }

  authenticateDevice = async (characteristic, device) => {
    try {
      let receivedKey = characteristic.value.substring(4);
      let concatKeyInBytes = base64ToArrayBuffer(receivedKey);
      let encryptor = new aesjs.ModeOfOperation.ecb(blekey);
      let encryptedKeyInBytes = encryptor.encrypt(concatKeyInBytes);
      let finalValue = concatArrayAndCommand([3, 0], encryptedKeyInBytes);
      console.log(finalValue, arrayToBase64(finalValue));
      device.writeCharacteristicWithoutResponseForService('0000fee1-0000-1000-8000-00805f9b34fb', '00000009-0000-3512-2118-0009af100700', arrayToBase64(finalValue))
        .catch(error => {
          this.showAlert("Sending encrypted key back to device failed", error);
        })
    } catch (error) {
      this.showAlert('Failed to authenticate device', error);
    }
  }

  /** end of - Connect and authenticate device */

  disconnectFromDevice = async(deviceId) => {
    this.manager.cancelDeviceConnection(deviceId)
      .then(() => {
        this.setState({ connectedDevice: null })
      })
      .catch(error => {
        this.showAlert('Unable to disconnect from device', error);
      })
  }

  handleSuccess = () => {
    this.monitor.remove();
  }

  showAlert = (title, body) => {
    console.log(title, body);
    Alert.alert(
      title,
      '',
      [{
        text: 'Cancel',
        onPress: () => console.log('Cancel Pressed'),
        style: 'cancel'
      }],
      { cancelable: false }
    );
  }

  render() {
    return (
      <React.Fragment>
        <View style={styles.Container}>
          <View style={styles.Top}>
            {
              this.state.scanning ?
                <Button color={'#e63946'} title="Stop Search for devices" onPress={() => this.stopDeviceSearch()}></Button> :
                <Button color={'#1d3557'} title="Search for devices" onPress={() => this.searchDevices()}></Button>
            }
          </View>
          <View style={styles.Bottom}>
            {
              this.state.deviceList.map((device) => {
                return (
                  <View key={device.id} style={styles.DeviceBlockCover}>
                    <View style={styles.DeviceNameCover}>
                      <Text style={styles.DeviceName}>{device.name || "Unknown"}</Text>
                    </View>
                    <View style={styles.DeviceActionsCover}>
                      {
                        this.state.connectedDevice === device.id ?
                          <Button color={'#e63946'} title="Disconnect" onPress={() => this.disconnectFromDevice(device.id)}></Button> :
                          <Button color={'#1d3557'} title="Connect" disabled={this.state.disableConnectButton} onPress={() => this.connectToDevice(device.id)}></Button>
                      }
                    </View>
                  </View>
                )
              })
            }
          </View>
        </View>
      </React.Fragment>
    )
  }
}

const screenHeight = Dimensions.get('window').height;
const screenWidth = Dimensions.get('window').width;

const styles = StyleSheet.create({
  Container: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#a8dadc',
    flex: 1,
  },
  Bottom: {
    paddingTop: 20,
    display: 'flex',
    flexDirection: 'column',
    paddingLeft: 20,
    paddingRight: 20
  },
  DeviceBlockCover: {
    backgroundColor: '#457b9d',
    display: 'flex',
    flexDirection: 'row',
    height: screenHeight / 12,
    marginTop: 10,
    borderRadius : 10

  },
  DeviceNameCover: {
    flex: 5,
    paddingLeft: screenWidth / 15,
    justifyContent: 'center'
  },
  DeviceName: {
    fontWeight: 'bold',
    color: '#ffffff'
  },
  DeviceActionsCover: {
    flex: 5,
    paddingRight: screenWidth / 15,
    justifyContent: 'center'
  }
});

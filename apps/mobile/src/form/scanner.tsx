import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Text, View } from 'react-native';
import { Button, ModalScreen, styles } from '@/components/ui';
import { space } from '@/lib/theme';

/** Scan d'un code-barres ou QR code (P3.4.6), fonctionne hors ligne. */
export function ScannerModal({
  visible,
  onCancel,
  onScan,
}: {
  visible: boolean;
  onCancel: () => void;
  onScan: (data: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  return (
    <ModalScreen
      visible={visible}
      onClose={onCancel}
      onShow={() => {
        done.current = false;
      }}
    >
      <View style={{ padding: space.lg }}>
        <Text style={styles.title}>Scanner un code</Text>
      </View>
      {permission?.granted ? (
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{
            barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'datamatrix'],
          }}
          onBarcodeScanned={(result) => {
            if (done.current) return;
            done.current = true;
            onScan(result.data);
          }}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', padding: space.lg, gap: space.md }}>
          <Text style={styles.muted}>L’accès à la caméra est nécessaire pour scanner.</Text>
          <Button title="Autoriser la caméra" onPress={() => void requestPermission()} />
        </View>
      )}
      <View style={{ padding: space.lg }}>
        <Button title="Annuler" variant="outline" onPress={onCancel} />
      </View>
    </ModalScreen>
  );
}

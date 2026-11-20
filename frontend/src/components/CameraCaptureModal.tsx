import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Camera, Upload, RefreshCw, CheckCircle, AlertCircle, SwitchCamera, Loader2 } from 'lucide-react';
import { uploadBatchAttachment } from '../api';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  batchId: number;
  itemId?: number;
  onPhotoUploaded: () => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  batchId,
  itemId,
  onPhotoUploaded,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState<boolean>(false);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Callback ref: attaches stream to video the exact moment <video> node is mounted into DOM
  const setVideoRef = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    if (element && streamRef.current) {
      element.srcObject = streamRef.current;
      element.play().catch((err) => {
        console.warn('Video auto-play warning:', err);
      });
    }
  }, []);

  // When stream state changes, also update the mounted video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => {
        console.warn('Video auto-play warning:', err);
      });
    }
  }, [stream]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      resetCapture();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    setStreamActive(false);
  };

  const startCamera = async (deviceId?: string) => {
    try {
      setIsLoadingCamera(true);
      setErrorMsg(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg('Camera access is not supported by your browser or requires HTTPS / localhost. Please use the Upload button.');
        setIsLoadingCamera(false);
        return;
      }

      // Stop existing tracks first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      let newStream: MediaStream;

      if (deviceId) {
        // Specific device selected (e.g., flip camera)
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } else {
        // Try ideal environment camera first, then fall back gracefully
        try {
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch {
          try {
            newStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user' },
              audio: false,
            });
          } catch {
            newStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }
      }

      streamRef.current = newStream;
      setStream(newStream);
      setStreamActive(true);

      // Immediately connect to video element if already mounted
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch((err) => {
          console.warn('Playback error:', err);
        });
      }

      // Query available video devices for multi-camera switching
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setAvailableDevices(videoInputs);
        if (!deviceId && videoInputs.length > 0) {
          const activeTrack = newStream.getVideoTracks()[0];
          const settings = activeTrack.getSettings ? activeTrack.getSettings() : null;
          if (settings && settings.deviceId) {
            setCurrentDeviceId(settings.deviceId);
          } else {
            setCurrentDeviceId(videoInputs[0].deviceId);
          }
        }
      } catch (e) {
        console.warn('Device enumeration error:', e);
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera permission denied. Please allow camera permissions in your browser URL settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMsg('No camera hardware found on this device. You can upload an image file instead.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMsg('Camera is already in use by another application or tab. Please close other apps and try again.');
      } else {
        setErrorMsg(err.message || 'Unable to open camera. You can upload a photo file instead.');
      }
      setStreamActive(false);
    } finally {
      setIsLoadingCamera(false);
    }
  };

  const handleSwitchCamera = () => {
    if (availableDevices.length <= 1) return;
    const currentIndex = availableDevices.findIndex((d) => d.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % availableDevices.length;
    const nextDevice = availableDevices[nextIndex];
    setCurrentDeviceId(nextDevice.deviceId);
    startCamera(nextDevice.deviceId);
  };

  const resetCapture = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setCapturedBlob(null);
    setPreviewUrl(null);
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setPreviewUrl(URL.createObjectURL(blob));
          stopCamera();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Image size exceeds 10 MB limit.');
      return;
    }

    setCapturedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    stopCamera();
  };

  const handleSaveAttachment = async () => {
    if (!capturedBlob) return;
    try {
      setIsUploading(true);
      setErrorMsg(null);
      const source = streamActive || !fileInputRef.current?.files?.length ? 'TFT_CAMERA' : 'FILE_UPLOAD';
      await uploadBatchAttachment(batchId, capturedBlob, source, itemId);
      onPhotoUploaded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload photo evidence.');
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-slate-700" />
            <h3 className="font-bold text-sm text-slate-900">
              Attach Inspection Photo
            </h3>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewport */}
        <div className="p-5 space-y-3.5">
          <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden relative flex items-center justify-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Captured Inspection"
                className="w-full h-full object-contain bg-slate-950"
              />
            ) : (
              <>
                <video
                  ref={setVideoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => {
                    videoRef.current?.play().catch(() => {});
                  }}
                  className={`w-full h-full object-cover ${streamActive ? 'block' : 'hidden'}`}
                />

                {isLoadingCamera && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white gap-2 z-10">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                    <p className="text-xs text-slate-300 font-medium">Starting camera...</p>
                  </div>
                )}

                {!streamActive && !isLoadingCamera && (
                  <div className="text-slate-400 text-center p-4">
                    <Camera className="w-8 h-8 mx-auto mb-1.5 opacity-50" />
                    <p className="text-xs">Camera is inactive or access was denied.</p>
                  </div>
                )}

                {/* Flip camera button if multiple cameras detected */}
                {streamActive && availableDevices.length > 1 && (
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    title="Switch Camera"
                    className="absolute top-2.5 right-2.5 bg-slate-900/75 hover:bg-slate-900 text-white p-2 rounded-lg backdrop-blur-sm transition-all z-20 flex items-center gap-1.5 text-[11px]"
                  >
                    <SwitchCamera className="w-3.5 h-3.5" />
                    <span>Flip</span>
                  </button>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2">
            {previewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    resetCapture();
                    startCamera(currentDeviceId || undefined);
                  }}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retake
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleSaveAttachment}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {isUploading ? 'Uploading...' : 'Save Photo'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={!streamActive}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </>
            )}
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

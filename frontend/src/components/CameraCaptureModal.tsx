import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Upload, RefreshCw, CheckCircle, AlertCircle, Loader2, Video } from 'lucide-react';
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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Attach stream to video element whenever stream changes or video mounts
  const attachStreamToVideo = (targetStream: MediaStream | null) => {
    if (videoRef.current && targetStream) {
      const video = videoRef.current;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = targetStream;

      const playVideo = () => {
        video.play().catch((err) => {
          console.warn('[Camera] Autoplay play() rejected:', err);
        });
      };

      video.onloadedmetadata = () => {
        playVideo();
      };
      video.oncanplay = () => {
        playVideo();
      };

      // Also trigger immediately
      playVideo();
    }
  };

  useEffect(() => {
    if (isOpen) {
      resetCapture();
      initDevicesAndStartCamera();
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
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setStreamActive(false);
  };

  const initDevicesAndStartCamera = async (deviceIdToUse?: string) => {
    try {
      setIsLoadingCamera(true);
      setErrorMsg(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg('Camera access is not supported by your browser or requires HTTPS / localhost. Please use the Upload button.');
        setIsLoadingCamera(false);
        return;
      }

      // Stop existing stream first
      stopCamera();

      // Determine constraints:
      // Desktop/Windows should NOT force 'environment' facing mode because it often maps to Windows Hello IR sensors or virtual devices
      let constraints: MediaStreamConstraints;
      if (deviceIdToUse) {
        constraints = {
          video: {
            deviceId: { exact: deviceIdToUse },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        };
      } else {
        constraints = {
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        };
      }

      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr: any) {
        // Fallback to minimal basic constraint
        console.warn('[Camera] Ideal constraints failed, trying minimal fallback:', firstErr);
        newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = newStream;
      setStream(newStream);
      setStreamActive(true);

      // Attach stream to DOM video element
      attachStreamToVideo(newStream);

      // Query available video devices
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setAvailableDevices(videoInputs);

        const activeTrack = newStream.getVideoTracks()[0];
        const activeTrackSettings = activeTrack.getSettings ? activeTrack.getSettings() : null;
        if (activeTrackSettings?.deviceId) {
          setSelectedDeviceId(activeTrackSettings.deviceId);
        } else if (deviceIdToUse) {
          setSelectedDeviceId(deviceIdToUse);
        } else if (videoInputs.length > 0) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (enumErr) {
        console.warn('[Camera] Device enumeration warning:', enumErr);
      }
    } catch (err: any) {
      console.error('[Camera] Access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMsg('Camera permission was denied. Please allow camera permissions in your browser URL settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMsg('No camera hardware found on this system. You can upload an image file instead.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMsg('Camera is currently in use by another tab or app (e.g. Teams, Zoom). Please close other apps and click Restart Camera.');
      } else {
        setErrorMsg(err.message || 'Unable to open camera stream. You can upload a photo file instead.');
      }
      setStreamActive(false);
    } finally {
      setIsLoadingCamera(false);
    }
  };

  const handleDeviceChange = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    initDevicesAndStartCamera(newDeviceId);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 no-print backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-slate-800" />
            <h3 className="font-bold text-sm text-slate-900">
              Attach Inspection Photo
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera Selector & Tools Bar */}
        {!previewUrl && (
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Video className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {availableDevices.length > 0 ? (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-800 text-[11px] rounded-md px-2 py-1 font-medium focus:outline-none focus:ring-1 focus:ring-slate-900 truncate w-full"
                >
                  {availableDevices.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] text-slate-600 truncate font-medium">
                  {streamActive ? 'Active Camera' : 'Detecting camera...'}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => initDevicesAndStartCamera(selectedDeviceId || undefined)}
              title="Restart / Refresh Camera Stream"
              className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-slate-700 font-medium flex items-center gap-1 text-[11px] shrink-0 transition-colors shadow-2xs"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingCamera ? 'animate-spin' : ''}`} />
              <span>Restart</span>
            </button>
          </div>
        )}

        {/* Viewport */}
        <div className="p-5 space-y-3.5">
          <div className="aspect-video bg-black rounded-xl overflow-hidden relative flex items-center justify-center border border-slate-800 shadow-inner">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Captured Inspection"
                className="w-full h-full object-contain bg-black"
              />
            ) : (
              <>
                {/* Video element is permanently mounted to prevent decoder pipeline suspension */}
                <video
                  ref={(el) => {
                    videoRef.current = el;
                    if (el && streamRef.current) {
                      attachStreamToVideo(streamRef.current);
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />

                {/* Loading state overlay */}
                {isLoadingCamera && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white gap-2 z-10">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
                    <p className="text-xs text-slate-300 font-medium">Connecting to camera...</p>
                  </div>
                )}

                {/* Inactive state overlay */}
                {!streamActive && !isLoadingCamera && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-400 p-4 text-center z-10">
                    <Camera className="w-8 h-8 mx-auto mb-1.5 opacity-40 text-slate-400" />
                    <p className="text-xs font-medium text-slate-300">Camera is inactive</p>
                    <p className="text-[11px] text-slate-500 mt-1">Click Restart or use the Upload button below.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Privacy Slider Guide when active */}
          {streamActive && !previewUrl && (
            <div className="bg-amber-50 border border-amber-200/80 text-amber-900 rounded-lg p-2.5 text-[11px] leading-relaxed flex items-start gap-2">
              <span className="font-bold text-amber-700 shrink-0">💡 Note:</span>
              <span>
                If the screen is black, please check that your laptop/webcam&apos;s physical privacy shutter or slider is open, or choose a different camera from the dropdown above.
              </span>
            </div>
          )}

          {/* Controls Bar */}
          <div className="flex gap-2">
            {previewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    resetCapture();
                    initDevicesAndStartCamera(selectedDeviceId || undefined);
                  }}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retake Photo
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleSaveAttachment}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  {isUploading ? 'Uploading...' : 'Save & Attach'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={!streamActive}
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload Image
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
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Upload, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
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
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const startCamera = async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setStreamActive(true);
    } catch (err: any) {
      setErrorMsg('Camera not accessible. You can upload an image file instead.');
      setStreamActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreamActive(false);
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
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setPreviewUrl(URL.createObjectURL(blob));
          stopCamera();
        }
      },
      'image/jpeg',
      0.9
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
            className="text-slate-400 hover:text-slate-700"
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
                alt="Captured"
                className="w-full h-full object-contain"
              />
            ) : streamActive ? (
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
            ) : (
              <div className="text-slate-400 text-center p-4">
                <Camera className="w-8 h-8 mx-auto mb-1.5 opacity-50" />
                <p className="text-xs">Camera is inactive.</p>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {previewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    resetCapture();
                    startCamera();
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
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center gap-1.5 transition-colors"
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

import io
import base64
import qrcode
from qrcode.image.styledpil import StyledPilImage
import barcode
from barcode import Code128
from barcode.writer import ImageWriter

def generate_qr_base64(data: str) -> str:
    """Generates a high-contrast black and white QR code as a base64 PNG data URL."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    b64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"

def generate_barcode_base64(data: str) -> str:
    """Generates a high-contrast Code128 1D barcode as a base64 PNG data URL."""
    # Clean data to standard ASCII alphanumeric if needed
    clean_data = "".join(c for c in data if 32 <= ord(c) <= 126) or "TAA-DEFAULT"
    try:
        code128 = Code128(clean_data, writer=ImageWriter())
        buffered = io.BytesIO()
        code128.write(buffered, options={
            "module_width": 0.25,
            "module_height": 12.0,
            "font_size": 10,
            "text_distance": 4.0,
            "quiet_zone": 3.0,
            "write_text": True
        })
        b64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64_str}"
    except Exception as e:
        # Fallback to simple barcode representation
        buffered = io.BytesIO()
        code128 = Code128("TAA-SCAN", writer=ImageWriter())
        code128.write(buffered)
        b64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64_str}"

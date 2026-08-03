Đặt các tệp mô hình Transkun ONNX tại đây nếu muốn chạy hoàn toàn cục bộ (không phụ thuộc Hugging Face lúc runtime):

  transkun.onnx
  transkun-heads.onnx
  freq2mels.f32
  windows.f32
  symbols.i32
  params.json

Tải từ: https://huggingface.co/TuesdayCrowd/transkun-onnx/tree/main

Sau đó trong ứng dụng, mở "Tùy chọn nâng cao" và đổi Base URL thành: /models/transkun/

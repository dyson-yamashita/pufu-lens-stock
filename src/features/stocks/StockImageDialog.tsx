import { Modal } from '../../components/Modal';

export default function StockImageDialog({
  image,
  onClose,
}: {
  image: { filename: string; url: string };
  onClose: () => void;
}) {
  return (
    <Modal title={image.filename} onClose={onClose} className="stock-image-dialog">
      <img src={image.url} alt={image.filename} />
    </Modal>
  );
}

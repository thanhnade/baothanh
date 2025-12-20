package my_spring_app.my_spring_app.service;

import my_spring_app.my_spring_app.dto.reponse.AnsibleOperationResponse;
import my_spring_app.my_spring_app.dto.reponse.AnsibleTaskStatusResponse;
import my_spring_app.my_spring_app.dto.reponse.DockerStatusResponse;
import my_spring_app.my_spring_app.dto.request.InstallDockerRequest;
import my_spring_app.my_spring_app.dto.request.DockerLoginRequest;

public interface DockerService {

    /**
     * Kiểm tra trạng thái Docker trên server
     * @return DockerStatusResponse chứa thông tin trạng thái Docker
     */
    DockerStatusResponse getDockerStatus();

    /**
     * Cài đặt Docker trên server
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse installDocker(InstallDockerRequest request);

    /**
     * Gỡ Docker khỏi server
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse uninstallDocker(InstallDockerRequest request);

    /**
     * Cài đặt lại Docker trên server
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse reinstallDocker(InstallDockerRequest request);

    /**
     * Lấy trạng thái task Docker
     * @param taskId ID của task
     * @return AnsibleTaskStatusResponse chứa trạng thái và logs
     */
    AnsibleTaskStatusResponse getDockerTaskStatus(String taskId);

    /**
     * Test Docker container bằng hello-world
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse testDockerContainer(InstallDockerRequest request);

    /**
     * Đăng nhập Docker Hub
     * @param request chứa thông tin đăng nhập
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse loginDocker(DockerLoginRequest request);

    /**
     * Kiểm tra Docker containers đang chạy (docker ps)
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse checkDockerPs(InstallDockerRequest request);

    /**
     * Liệt kê Docker images (docker images)
     * @param request chứa thông tin server và password
     * @return AnsibleOperationResponse kết quả thực hiện
     */
    AnsibleOperationResponse listDockerImages(InstallDockerRequest request);
}
